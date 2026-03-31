import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@rockbed/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [
    nextCookies(),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
