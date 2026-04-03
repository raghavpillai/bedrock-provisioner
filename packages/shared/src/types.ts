import type { z } from "zod";
import type { RegionInput, CreateKeyInput, DeleteKeyInput } from "./schemas";

export type RegionInputT = z.infer<typeof RegionInput>;
export type CreateKeyInputT = z.infer<typeof CreateKeyInput>;
export type DeleteKeyInputT = z.infer<typeof DeleteKeyInput>;

export type Identity = {
  account: string;
  arn: string;
  userId: string;
};

export type BedrockKey = {
  userName: string;
  friendlyName: string;
  credentialId: string;
  apiKeyId: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  createdBy: string | null;
  dailySpendLimit: string;
  autoDisabledAt: string | null;
};

export type NewBedrockKey = {
  userName: string;
  credentialId: string;
  apiKey: string;
  apiKeyId: string;
  createdAt: string;
  expiresAt: string | null;
  status: string;
};

export type BedrockModel = {
  modelId: string;
  modelName: string;
  modelArn: string;
  provider: string;
  inputModalities: string[];
  outputModalities: string[];
  streaming: boolean;
  inferenceTypes: string[];
  customizations: string[];
  lifecycleStatus: string;
  releaseDate: string | null;
};

export type BedrockQuota = {
  quotaCode: string;
  quotaName: string;
  value: number;
  unit: string;
  adjustable: boolean;
  globalQuota: boolean;
};
