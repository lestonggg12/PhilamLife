import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const allowedRoles = new Set(["admin", "secretary", "treasurer"]);

const cleanName = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const cleanEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SECRET_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Supabase server environment is not configured." }, 500);
    }
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "You must be signed in." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.slice(7);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid or expired session." }, 401);

    const actor = authData.user;
    const { data: actorProfile, error: actorError } = await admin
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("id", actor.id)
      .single();

    if (
      actorError ||
      !actorProfile ||
      actorProfile.role?.toLowerCase() !== "admin" ||
      actorProfile.is_active === false
    ) {
      return json({ error: "Only an active administrator can manage users." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    const writeLog = async (
      targetId: string | null,
      targetName: string,
      logAction: string,
      details: string,
    ) => {
      const { error } = await admin.from("user_management_logs").insert({
        actor_id: actor.id,
        actor_name: actorProfile.full_name || actor.email || "Administrator",
        target_user_id: targetId,
        target_user_name: targetName,
        action: logAction,
        details,
      });
      if (error) console.error("Activity log error:", error.message);
    };

    if (action === "list") {
      const { data: authUsers, error: listError } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) throw listError;

      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at, updated_at");
      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      const users = authUsers.users.map((user) => {
        const profile = profileMap.get(user.id);
        return {
          id: user.id,
          name: profile?.full_name || user.user_metadata?.full_name || "Unnamed User",
          email: profile?.email || user.email || "",
          role: profile?.role || "secretary",
          status: profile?.is_active === false || user.banned_until ? "Inactive" : "Active",
          is_active: profile?.is_active !== false && !user.banned_until,
          created_at: profile?.created_at || user.created_at,
          updated_at: profile?.updated_at || user.updated_at,
          last_sign_in_at: user.last_sign_in_at,
          is_current_user: user.id === actor.id,
        };
      });
      return json({ users });
    }

    if (action === "create") {
      const fullName = cleanName(body.fullName);
      const email = cleanEmail(body.email);
      const role = cleanName(body.role).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";

      if (!fullName || !email || !allowedRoles.has(role)) {
        return json({ error: "Enter a valid name, email, and role." }, 400);
      }
      if (password.length < 8) {
        return json({ error: "The temporary password must have at least 8 characters." }, 400);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role },
      });
      if (createError || !created.user) throw createError ?? new Error("Account was not created.");

      const { error: profileError } = await admin.from("profiles").upsert({
        id: created.user.id,
        full_name: fullName,
        email,
        role,
        is_active: true,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      await writeLog(created.user.id, fullName, "CREATE_USER", `Created ${role} account for ${email}.`);
      return json({ message: "Account created successfully.", userId: created.user.id }, 201);
    }

    const targetId = typeof body.userId === "string" ? body.userId : "";
    if (!targetId) return json({ error: "A user account must be selected." }, 400);

    const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetId);
    if (targetError || !targetResult.user) return json({ error: "User account not found." }, 404);
    const target = targetResult.user;

    const { data: targetProfile } = await admin
      .from("profiles")
      .select("full_name, email, role, is_active")
      .eq("id", targetId)
      .maybeSingle();
    const targetName = targetProfile?.full_name || target.email || "User";

    if (action === "update") {
      const fullName = cleanName(body.fullName);
      const role = cleanName(body.role).toLowerCase();
      if (!fullName || !allowedRoles.has(role)) {
        return json({ error: "Enter a valid name and role." }, 400);
      }
      if (targetId === actor.id && role !== "admin") {
        return json({ error: "You cannot remove your own administrator role." }, 400);
      }

      const { error: metadataError } = await admin.auth.admin.updateUserById(targetId, {
        user_metadata: { ...target.user_metadata, full_name: fullName, role },
      });
      if (metadataError) throw metadataError;

      const { error: updateError } = await admin.from("profiles").update({
        full_name: fullName,
        role,
      }).eq("id", targetId);
      if (updateError) throw updateError;

      await writeLog(targetId, fullName, "UPDATE_USER", `Updated name and role to ${role}.`);
      return json({ message: "User details updated successfully." });
    }

    if (action === "set-active") {
      const isActive = body.isActive === true;
      if (targetId === actor.id && !isActive) {
        return json({ error: "You cannot deactivate your own account." }, 400);
      }

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: isActive ? "none" : "876000h",
      });
      if (authUpdateError) throw authUpdateError;

      const { error: statusError } = await admin
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", targetId);
      if (statusError) throw statusError;

      await writeLog(
        targetId,
        targetName,
        isActive ? "ACTIVATE_USER" : "DEACTIVATE_USER",
        `${isActive ? "Activated" : "Deactivated"} ${target.email}.`,
      );
      return json({ message: `Account ${isActive ? "activated" : "deactivated"} successfully.` });
    }

    if (action === "reset-password") {
      if (!target.email) return json({ error: "This user has no email address." }, 400);

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) return json({ error: "SUPABASE_ANON_KEY is not configured." }, 500);
      const publicClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const redirectTo = typeof body.redirectTo === "string" && body.redirectTo
        ? body.redirectTo
        : undefined;
      const { error: resetError } = await publicClient.auth.resetPasswordForEmail(
        target.email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (resetError) throw resetError;

      await writeLog(targetId, targetName, "RESET_PASSWORD", `Sent a password-reset email to ${target.email}.`);
      return json({ message: "Password-reset email sent successfully." });
    }

    return json({ error: "Unknown user-management action." }, 400);
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "An unexpected server error occurred." },
      500,
    );
  }
});