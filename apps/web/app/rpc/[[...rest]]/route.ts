import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import { router } from "@rockbed/api";

const handler = new RPCHandler(router, {
  interceptors: [onError((error) => console.error("[rpc]", error))],
});

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: "/rpc",
    context: {},
  });
  return response ?? new Response("Not found", { status: 404 });
}

export const maxDuration = 60;

export const GET = handleRequest;
export const POST = handleRequest;
