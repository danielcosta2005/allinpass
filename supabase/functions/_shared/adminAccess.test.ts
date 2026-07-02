import { sendInvitationEmail } from "./adminAccess.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

Deno.test("sendInvitationEmail keeps resend delivery on the Invite user auth template", async () => {
  const calls: string[] = [];
  const supabaseAdmin = {
    auth: {
      admin: {
        inviteUserByEmail: async () => {
          calls.push("inviteUserByEmail");
          return { data: { user: { id: "auth-user-id" } }, error: null };
        },
        listUsers: async () => {
          calls.push("listUsers");
          return { data: { users: [{ id: "auth-user-id", email: "staff@example.com" }] }, error: null };
        },
      },
      signInWithOtp: async () => {
        calls.push("signInWithOtp");
        return { error: null };
      },
    },
  };

  const result = await sendInvitationEmail({
    supabaseAdmin,
    req: new Request("https://functions.example.test", {
      headers: { Origin: "https://app.example.test" },
    }),
    email: "staff@example.com",
    invitationId: "invitation-id",
    nonce: "invite-nonce",
    preferInvite: false,
    data: { invite_type: "project_member", role: "staff" },
  });

  assertEquals(calls, ["inviteUserByEmail"]);
  assertEquals(result, { userId: "auth-user-id", delivery: "invite" });
});

Deno.test("sendInvitationEmail does not fall back to OTP when the invite template cannot be used", async () => {
  const calls: string[] = [];
  const supabaseAdmin = {
    auth: {
      admin: {
        inviteUserByEmail: async () => {
          calls.push("inviteUserByEmail");
          return { data: { user: null }, error: new Error("User already registered") };
        },
        listUsers: async () => {
          calls.push("listUsers");
          return { data: { users: [{ id: "auth-user-id", email: "staff@example.com" }] }, error: null };
        },
      },
      signInWithOtp: async () => {
        calls.push("signInWithOtp");
        return { error: null };
      },
    },
  };

  let thrown: Error | null = null;
  try {
    await sendInvitationEmail({
      supabaseAdmin,
      req: new Request("https://functions.example.test", {
        headers: { Origin: "https://app.example.test" },
      }),
      email: "staff@example.com",
      invitationId: "invitation-id",
      nonce: "invite-nonce",
      data: { invite_type: "project_member", role: "staff" },
    });
  } catch (error) {
    thrown = error as Error;
  }

  if (!thrown) {
    throw new Error("Expected invite failure to be thrown");
  }

  assertEquals(thrown.message, "User already registered");
  assertEquals(calls, ["inviteUserByEmail"]);
});
