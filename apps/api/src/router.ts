import { os, ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  IAMClient,
  CreateUserCommand,
  AttachUserPolicyCommand,
  CreateServiceSpecificCredentialCommand,
  ListServiceSpecificCredentialsCommand,
  DeleteServiceSpecificCredentialCommand,
  ListUsersCommand,
  DetachUserPolicyCommand,
  DeleteUserCommand,
  TagUserCommand,
  ListUserTagsCommand,
} from "@aws-sdk/client-iam";
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import {
  ServiceQuotasClient,
  ListServiceQuotasCommand,
} from "@aws-sdk/client-service-quotas";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  RegionInput,
  CreateKeyInput,
  DeleteKeyInput,
  BEDROCK_POLICY_ARN,
  BEDROCK_SERVICE_NAME,
  USER_PREFIX,
} from "@bedrock-provisioner/shared";
import { prisma } from "@bedrock-provisioner/db";

function createClients(region: string) {
  const config = { region };
  return {
    iam: new IAMClient(config),
    bedrock: new BedrockClient(config),
    sts: new STSClient(config),
    quotas: new ServiceQuotasClient(config),
  };
}

// -- Procedures --

const whoAmI = os.input(RegionInput).handler(async ({ input }) => {
  const { sts } = createClients(input.region);
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  return {
    account: identity.Account!,
    arn: identity.Arn!,
    userId: identity.UserId!,
  };
});

const listModels = os.input(RegionInput).handler(async ({ input }) => {
  const { bedrock } = createClients(input.region);
  const res = await bedrock.send(new ListFoundationModelsCommand({}));
  return (res.modelSummaries ?? []).map((m) => ({
    modelId: m.modelId!,
    modelName: m.modelName!,
    modelArn: m.modelArn!,
    provider: m.providerName!,
    inputModalities: m.inputModalities ?? [],
    outputModalities: m.outputModalities ?? [],
    streaming: m.responseStreamingSupported ?? false,
    inferenceTypes: m.inferenceTypesSupported ?? [],
    customizations: m.customizationsSupported ?? [],
    lifecycleStatus: m.modelLifecycle?.status ?? "ACTIVE",
    releaseDate: m.modelLifecycle?.startOfLifeTime?.toISOString() ?? null,
  }));
});

const createKey = os.input(CreateKeyInput).handler(async ({ input }) => {
  const { iam } = createClients(input.region);
  const userName = `${USER_PREFIX}${input.name}`;

  // Create IAM user
  try {
    await iam.send(new CreateUserCommand({ UserName: userName }));
  } catch (err: any) {
    if (err.name === "EntityAlreadyExistsException") {
      throw new ORPCError("CONFLICT", {
        message: `A key with name "${input.name}" already exists`,
      });
    }
    throw err;
  }

  // Attach Bedrock policy
  await iam.send(
    new AttachUserPolicyCommand({
      UserName: userName,
      PolicyArn: BEDROCK_POLICY_ARN,
    })
  );

  // Create the service-specific credential (API key)
  const result = await iam.send(
    new CreateServiceSpecificCredentialCommand({
      UserName: userName,
      ServiceName: BEDROCK_SERVICE_NAME,
    })
  );

  const cred = result.ServiceSpecificCredential!;
  const createdAt = cred.CreateDate!;

  let expiresAt: string | null = null;
  if (input.expiryDays > 0) {
    const expiry = new Date(createdAt.getTime() + input.expiryDays * 86400000);
    expiresAt = expiry.toISOString();
  }

  // Tag the IAM user with metadata
  await iam.send(
    new TagUserCommand({
      UserName: userName,
      Tags: [
        { Key: "bedrock-provisioner:expiryDays", Value: String(input.expiryDays) },
        { Key: "bedrock-provisioner:expiresAt", Value: expiresAt ?? "never" },
        { Key: "bedrock-provisioner:createdBy", Value: input.createdBy ?? "unknown" },
      ],
    })
  );

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: "key.created",
      keyName: input.name,
      userName,
      region: input.region,
      metadata: JSON.stringify({ expiryDays: input.expiryDays, expiresAt, createdBy: input.createdBy }),
    },
  }).catch(() => {});

  return {
    userName,
    credentialId: cred.ServiceSpecificCredentialId!,
    apiKey: cred.ServiceCredentialSecret!,
    apiKeyId: cred.ServiceCredentialAlias!,
    createdAt: createdAt.toISOString(),
    expiresAt,
    status: cred.Status!,
  };
});

// AWS IAM is the ground truth for keys
const listKeys = os.input(RegionInput).handler(async ({ input }) => {
  const { iam } = createClients(input.region);

  const usersRes = await iam.send(new ListUsersCommand({ PathPrefix: "/" }));
  const bedrockUsers = (usersRes.Users ?? []).filter((u) =>
    u.UserName?.startsWith(USER_PREFIX)
  );

  const keys = [];
  for (const user of bedrockUsers) {
    const [credsRes, tagsRes] = await Promise.all([
      iam.send(
        new ListServiceSpecificCredentialsCommand({
          UserName: user.UserName!,
          ServiceName: BEDROCK_SERVICE_NAME,
        })
      ),
      iam.send(new ListUserTagsCommand({ UserName: user.UserName! })).catch(
        () => ({ Tags: [] })
      ),
    ]);

    const tags = tagsRes.Tags ?? [];
    const expiresAtTag = tags.find(
      (t) => t.Key === "bedrock-provisioner:expiresAt"
    );
    const expiresAt =
      expiresAtTag?.Value && expiresAtTag.Value !== "never"
        ? expiresAtTag.Value
        : null;
    const createdByTag = tags.find(
      (t) => t.Key === "bedrock-provisioner:createdBy"
    );
    const createdBy =
      createdByTag?.Value && createdByTag.Value !== "unknown"
        ? createdByTag.Value
        : null;

    for (const cred of credsRes.ServiceSpecificCredentials ?? []) {
      keys.push({
        userName: user.UserName!,
        friendlyName: user.UserName!.replace(USER_PREFIX, ""),
        credentialId: cred.ServiceSpecificCredentialId!,
        apiKeyId: cred.ServiceCredentialAlias!,
        status: cred.Status!,
        createdAt: cred.CreateDate!.toISOString(),
        expiresAt,
        createdBy,
      });
    }
  }

  return keys;
});

const deleteKey = os.input(DeleteKeyInput).handler(async ({ input }) => {
  const { iam } = createClients(input.region);

  await iam.send(
    new DeleteServiceSpecificCredentialCommand({
      UserName: input.userName,
      ServiceSpecificCredentialId: input.credentialId,
    })
  );

  try {
    await iam.send(
      new DetachUserPolicyCommand({
        UserName: input.userName,
        PolicyArn: BEDROCK_POLICY_ARN,
      })
    );
    await iam.send(new DeleteUserCommand({ UserName: input.userName }));
  } catch {
    // User may have other credentials; ignore cleanup errors
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: "key.deleted",
      keyName: input.userName.replace(USER_PREFIX, ""),
      userName: input.userName,
      region: input.region,
    },
  }).catch(() => {});

  return { success: true };
});

// Cache quotas for 5 minutes
const quotaCache = new Map<string, { data: any[]; expiry: number }>();

const listQuotas = os.input(RegionInput).handler(async ({ input }) => {
  const cacheKey = input.region;
  const cached = quotaCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.data;

  const { quotas } = createClients(input.region);
  const allQuotas = [];
  let nextToken: string | undefined;

  do {
    const res = await quotas.send(
      new ListServiceQuotasCommand({
        ServiceCode: "bedrock",
        MaxResults: 100,
        NextToken: nextToken,
      })
    );
    for (const q of res.Quotas ?? []) {
      const name = q.QuotaName ?? "";
      if (!/tokens per minute|requests per minute/i.test(name)) continue;
      allQuotas.push({
        quotaCode: q.QuotaCode!,
        quotaName: name,
        value: q.Value!,
        unit: q.Unit ?? "",
        adjustable: q.Adjustable ?? false,
        globalQuota: q.GlobalQuota ?? false,
      });
    }
    nextToken = res.NextToken;
  } while (nextToken);

  quotaCache.set(cacheKey, { data: allQuotas, expiry: Date.now() + 300_000 });
  return allQuotas;
});

// -- Favorites --

const listFavorites = os.handler(async () => {
  const favs = await prisma.favoriteModel.findMany({
    orderBy: { createdAt: "desc" },
  });
  return favs.map((f) => f.modelId);
});

const toggleFavorite = os
  .input(z.object({ modelId: z.string() }))
  .handler(async ({ input }) => {
    const existing = await prisma.favoriteModel.findUnique({
      where: { modelId: input.modelId },
    });
    if (existing) {
      await prisma.favoriteModel.delete({
        where: { modelId: input.modelId },
      });
      return { favorited: false };
    } else {
      await prisma.favoriteModel.create({
        data: { modelId: input.modelId },
      });
      return { favorited: true };
    }
  });

// -- Settings --

const getSettings = os.handler(async () => {
  const region = await prisma.setting.findUnique({ where: { key: "default_region" } });
  return { defaultRegion: region?.value ?? "us-east-1" };
});

const setDefaultRegion = os
  .input(z.object({ region: z.string() }))
  .handler(async ({ input }) => {
    await prisma.setting.upsert({
      where: { key: "default_region" },
      update: { value: input.region },
      create: { key: "default_region", value: input.region },
    });
    return { ok: true };
  });

// -- Router --

export const router = {
  identity: {
    whoAmI,
  },
  models: {
    list: listModels,
  },
  keys: {
    create: createKey,
    list: listKeys,
    delete: deleteKey,
  },
  quotas: {
    list: listQuotas,
  },
  favorites: {
    list: listFavorites,
    toggle: toggleFavorite,
  },
  settings: {
    get: getSettings,
    setRegion: setDefaultRegion,
  },
};

export type Router = typeof router;
