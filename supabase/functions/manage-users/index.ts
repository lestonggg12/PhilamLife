import { createClient } from "@supabase/supabase-js";

const BUCKET = "hoa-documents";
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const cleanFileName = (value: unknown) => {
  const fileName = cleanText(value, 255)
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ");
  return fileName.toLowerCase().endsWith(".pdf")
    ? fileName
    : `${fileName || "homeowner-notice"}.pdf`;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );

const toBase64 = (bytes: Uint8Array) => {
  let result = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(result);
};

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

type Delivery = {
  id: string;
  property_id: number | null;
  homeowner_name: string;
  recipient_email: string;
  attempt_count: number;
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let campaignId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM");
    const authHeader = request.headers.get("Authorization");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase server configuration is incomplete." }, 500);
    }

    if (!resendApiKey || !resendFrom) {
      return json(
        {
          error:
            "Email sending is not configured. Add RESEND_API_KEY and RESEND_FROM to the Edge Function secrets.",
        },
        503,
      );
    }

    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "You must be signed in." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.slice(7);
    const { data: authData, error: authError } =
      await admin.auth.getUser(token);

    if (authError || !authData.user) {
      return json({ error: "Your session is invalid or expired." }, 401);
    }

    const actor = authData.user;
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("id", actor.id)
      .single();

    if (
      profileError ||
      !profile ||
      profile.is_active === false ||
      profile.role?.trim().toLowerCase() !== "secretary"
    ) {
      return json(
        { error: "Only the active Secretary can send homeowner PDFs." },
        403,
      );
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "retry" ? "retry" : "send";
    let storagePath = "";
    let subject = "";
    let message = "";
    let originalFileName = "";
    let deliveries: Delivery[] = [];
    let skippedCount = 0;

    if (mode === "retry") {
      campaignId = cleanText(body.campaignId, 64);

      if (!campaignId) {
        return json({ error: "A campaign ID is required." }, 400);
      }

      const { data: campaign, error: campaignError } = await admin
        .from("email_campaigns")
        .select(
          "id, subject, message, storage_path, original_file_name, skipped_count",
        )
        .eq("id", campaignId)
        .single();

      if (campaignError || !campaign) {
        return json({ error: "The email campaign was not found." }, 404);
      }

      const { data: failedDeliveries, error: deliveriesError } = await admin
        .from("email_deliveries")
        .select(
          "id, property_id, homeowner_name, recipient_email, attempt_count",
        )
        .eq("campaign_id", campaignId)
        .eq("status", "failed")
        .order("created_at");

      if (deliveriesError) throw deliveriesError;
      if (!failedDeliveries?.length) {
        return json({ error: "This campaign has no failed emails to retry." }, 409);
      }

      storagePath = campaign.storage_path;
      subject = campaign.subject;
      message = campaign.message;
      originalFileName = campaign.original_file_name;
      skippedCount = campaign.skipped_count;
      deliveries = failedDeliveries;

      await admin
        .from("email_campaigns")
        .update({ status: "sending", completed_at: null })
        .eq("id", campaignId);
    } else {
      storagePath = cleanText(body.storagePath, 600);
      subject = cleanText(body.subject, 200);
      message = cleanText(body.message, 5000);
      originalFileName = cleanFileName(body.fileName);
      const statedFileSize = Number(body.fileSize);

      const requiredPrefix = `email-campaigns/${actor.id}/`;
      if (
        !storagePath.startsWith(requiredPrefix) ||
        !storagePath.toLowerCase().endsWith(".pdf")
      ) {
        return json({ error: "The uploaded PDF path is invalid." }, 400);
      }

      if (!subject || !message) {
        return json({ error: "A subject and message are required." }, 400);
      }

      if (
        !Number.isFinite(statedFileSize) ||
        statedFileSize <= 0 ||
        statedFileSize > MAX_PDF_BYTES
      ) {
        return json({ error: "The PDF must be between 1 byte and 10 MB." }, 400);
      }

      const { data: existingCampaign } = await admin
        .from("email_campaigns")
        .select("id, status, recipient_count, sent_count, failed_count")
        .eq("storage_path", storagePath)
        .maybeSingle();

      if (existingCampaign) {
        return json(
          {
            error: "This PDF has already been submitted.",
            campaign: existingCampaign,
          },
          409,
        );
      }

      const { data: properties, error: propertiesError } = await admin
        .from("properties")
        .select("id, homeowner_name, contact_email")
        .order("id");

      if (propertiesError) throw propertiesError;

      const recipients = new Map<string, {
        property_id: number;
        homeowner_name: string;
        recipient_email: string;
      }>();

      for (const property of properties ?? []) {
        const email =
          typeof property.contact_email === "string"
            ? property.contact_email.trim().toLowerCase()
            : "";

        if (!EMAIL_PATTERN.test(email) || recipients.has(email)) {
          skippedCount += 1;
          continue;
        }

        recipients.set(email, {
          property_id: property.id,
          homeowner_name:
            cleanText(property.homeowner_name, 160) || "Homeowner",
          recipient_email: email,
        });
      }

      if (recipients.size === 0) {
        return json(
          { error: "No valid homeowner email addresses are available." },
          400,
        );
      }

      const { data: campaign, error: campaignError } = await admin
        .from("email_campaigns")
        .insert({
          subject,
          message,
          storage_path: storagePath,
          original_file_name: originalFileName,
          file_size: statedFileSize,
          status: "sending",
          recipient_count: recipients.size,
          skipped_count: skippedCount,
          created_by: actor.id,
          created_by_name:
            cleanText(profile.full_name, 160) || actor.email || "Secretary",
        })
        .select("id")
        .single();

      if (campaignError || !campaign) throw campaignError;
      campaignId = campaign.id;

      const { data: createdDeliveries, error: createDeliveriesError } =
        await admin
          .from("email_deliveries")
          .insert(
            [...recipients.values()].map((recipient) => ({
              campaign_id: campaignId,
              ...recipient,
            })),
          )
          .select(
            "id, property_id, homeowner_name, recipient_email, attempt_count",
          );

      if (createDeliveriesError) throw createDeliveriesError;
      deliveries = createdDeliveries ?? [];
    }

    const { data: pdfBlob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(storagePath);

    if (downloadError || !pdfBlob) {
      throw new Error(downloadError?.message || "The uploaded PDF was not found.");
    }

    if (pdfBlob.size <= 0 || pdfBlob.size > MAX_PDF_BYTES) {
      throw new Error("The PDF must be between 1 byte and 10 MB.");
    }

    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const pdfSignature = new TextDecoder().decode(pdfBytes.subarray(0, 5));

    if (pdfSignature !== "%PDF-") {
      throw new Error("The uploaded file is not a valid PDF.");
    }

    await admin
      .from("email_campaigns")
      .update({ file_size: pdfBlob.size })
      .eq("id", campaignId);

    const pdfBase64 = toBase64(pdfBytes);
    const { data: organization } = await admin
      .from("system_settings")
      .select("hoa_name, contact_email")
      .eq("id", 1)
      .maybeSingle();

    const hoaName = cleanText(organization?.hoa_name, 160) || "PHILAM Village";
    const replyTo = cleanText(organization?.contact_email, 320);
    const emailHtml = escapeHtml(message).replace(/\r?\n/g, "<br>");
    let sentCount = 0;
    let failedCount = 0;

    for (let index = 0; index < deliveries.length; index += 3) {
      const group = deliveries.slice(index, index + 3);

      await Promise.all(
        group.map(async (delivery) => {
          const attemptedAt = new Date().toISOString();
          const personalizedHtml = `<p>Dear ${escapeHtml(
            delivery.homeowner_name,
          )},</p><p>${emailHtml}</p><p>Regards,<br>${escapeHtml(hoaName)}</p>`;

          try {
            const response = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
                "Idempotency-Key": `${campaignId}/${delivery.id}`,
              },
              body: JSON.stringify({
                from: resendFrom,
                to: [delivery.recipient_email],
                subject,
                html: personalizedHtml,
                text: `Dear ${delivery.homeowner_name},\n\n${message}\n\nRegards,\n${hoaName}`,
                ...(EMAIL_PATTERN.test(replyTo) ? { reply_to: replyTo } : {}),
                attachments: [
                  { filename: originalFileName, content: pdfBase64 },
                ],
                tags: [
                  { name: "campaign_id", value: campaignId! },
                  { name: "property_id", value: String(delivery.property_id ?? "none") },
                ],
              }),
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
              throw new Error(
                cleanText(result?.message || result?.error, 1000) ||
                  `Resend returned HTTP ${response.status}.`,
              );
            }

            sentCount += 1;
            const { error: sentUpdateError } = await admin
              .from("email_deliveries")
              .update({
                status: "sent",
                resend_email_id: result.id || null,
                error_message: null,
                attempt_count: delivery.attempt_count + 1,
                last_attempt_at: attemptedAt,
                sent_at: attemptedAt,
              })
              .eq("id", delivery.id);

            if (sentUpdateError) throw sentUpdateError;
          } catch (error) {
            failedCount += 1;
            await admin
              .from("email_deliveries")
              .update({
                status: "failed",
                error_message:
                  error instanceof Error
                    ? error.message.slice(0, 1000)
                    : "Unknown email delivery error.",
                attempt_count: delivery.attempt_count + 1,
                last_attempt_at: attemptedAt,
              })
              .eq("id", delivery.id);
          }
        }),
      );

      if (index + 3 < deliveries.length) await sleep(450);
    }

    const { data: deliveryTotals, error: totalsError } = await admin
      .from("email_deliveries")
      .select("status")
      .eq("campaign_id", campaignId);

    if (totalsError) throw totalsError;

    const totalSent =
      deliveryTotals?.filter((delivery) => delivery.status === "sent").length ?? 0;
    const totalFailed =
      deliveryTotals?.filter((delivery) => delivery.status === "failed").length ??
      0;
    const finalStatus =
      totalFailed === 0
        ? "completed"
        : totalSent === 0
          ? "failed"
          : "partial";

    const { data: finalCampaign, error: updateCampaignError } = await admin
      .from("email_campaigns")
      .update({
        status: finalStatus,
        sent_count: totalSent,
        failed_count: totalFailed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaignId)
      .select(
        "id, status, recipient_count, sent_count, failed_count, skipped_count",
      )
      .single();

    if (updateCampaignError) throw updateCampaignError;

    await admin.from("activity_log").insert({
      user_id: actor.id,
      action: mode === "retry" ? "Homeowner PDF Retried" : "Homeowner PDF Sent",
      target: `${subject} — ${sentCount} sent, ${failedCount} failed in this attempt`,
    });

    return json({
      message:
        totalFailed === 0
          ? `PDF sent to all ${totalSent} homeowner email address(es).`
          : `PDF sent to ${totalSent}; ${totalFailed} email(s) failed.`,
      campaign: finalCampaign,
    });
  } catch (error) {
    console.error(error);

    if (campaignId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const errorMessage =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "Unexpected email delivery error.";

      await admin
        .from("email_deliveries")
        .update({
          status: "failed",
          error_message: errorMessage,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("campaign_id", campaignId)
        .eq("status", "pending");

      const { data: totals } = await admin
        .from("email_deliveries")
        .select("status")
        .eq("campaign_id", campaignId);
      const sentCount =
        totals?.filter((delivery) => delivery.status === "sent").length ?? 0;
      const failedCount =
        totals?.filter((delivery) => delivery.status !== "sent").length ?? 0;

      await admin
        .from("email_campaigns")
        .update({
          status: sentCount > 0 ? "partial" : "failed",
          sent_count: sentCount,
          failed_count: failedCount,
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    }

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected email sending error occurred.",
      },
      500,
    );
  }
});