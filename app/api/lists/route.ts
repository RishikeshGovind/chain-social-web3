import { NextResponse } from "next/server";
import { isValidAddress, normalizeAddress } from "@/lib/posts/content";
import { getActorAddressFromLensCookie } from "@/lib/server/auth/lens-actor";
import {
  addListMember,
  createUserList,
  deleteUserList,
  listUserLists,
  removeListMember,
  renameUserList,
} from "@/lib/server/lists/store";

async function getActor() {
  const actorAddress = await getActorAddressFromLensCookie();
  if (!actorAddress || !isValidAddress(actorAddress)) return null;
  return normalizeAddress(actorAddress);
}

export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lists = await listUserLists(actor);
  return NextResponse.json({ actor, lists });
}

export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name : "";
  const result = await createUserList(actor, name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const lists = await listUserLists(actor);
  return NextResponse.json({ actor, list: result.list, lists }, { status: 201 });
}

export async function PATCH(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const listId = typeof body?.listId === "string" ? body.listId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!listId || !action) {
    return NextResponse.json({ error: "Missing list action payload" }, { status: 400 });
  }

  let result:
    | Awaited<ReturnType<typeof renameUserList>>
    | Awaited<ReturnType<typeof addListMember>>
    | Awaited<ReturnType<typeof removeListMember>>;

  if (action === "rename") {
    result = await renameUserList(actor, listId, typeof body?.name === "string" ? body.name : "");
  } else if (action === "add_member") {
    result = await addListMember(
      actor,
      listId,
      typeof body?.memberAddress === "string" ? body.memberAddress : ""
    );
  } else if (action === "remove_member") {
    result = await removeListMember(
      actor,
      listId,
      typeof body?.memberAddress === "string" ? body.memberAddress : ""
    );
  } else {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const lists = await listUserLists(actor);
  return NextResponse.json({ actor, list: result.list, lists });
}

export async function DELETE(req: Request) {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const listId = typeof body?.listId === "string" ? body.listId : "";
  if (!listId) {
    return NextResponse.json({ error: "Missing list id" }, { status: 400 });
  }

  const result = await deleteUserList(actor, listId);
  if (result.removed === 0) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  const lists = await listUserLists(actor);
  return NextResponse.json({ actor, ...result, lists });
}
