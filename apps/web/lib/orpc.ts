import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { Router } from "@rockbed/api/router";

const link = new RPCLink({
  url:
    typeof window !== "undefined"
      ? `${window.location.origin}/rpc`
      : "http://localhost:3000/rpc",
});

export const client: RouterClient<Router> = createORPCClient(link);
