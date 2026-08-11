import { Hono } from "hono";

import { uploadToCloudinary } from "@/server/cloudinary.server";
import {
  assertDocumentAccess,
  createDocumentDataUrl,
  getAuthContext,
  removeDocumentBlobs,
  uploadDocumentBlob,
} from "@/server/livey-service.server";

export const documentRoutes = new Hono();

documentRoutes.post("/", async (c) => {
  const form = await c.req.formData();
  const bucket = String(form.get("bucket") ?? "partner-documents");
  const filePath = String(form.get("filePath") ?? "");
  const fileName = String(form.get("fileName") ?? filePath.split("/").pop() ?? "document");
  const mimeType = String(form.get("mimeType") ?? "application/octet-stream");
  const file = form.get("file");

  if (!(file instanceof File)) {
    return c.json({ message: "Missing file" }, 400);
  }

  await assertDocumentAccess({ bucket, filePath, operation: "write" });

  return c.json(
    await uploadDocumentBlob({
      bucket,
      filePath,
      fileName,
      mimeType,
      file,
      isSeed: String(form.get("isSeed") ?? "false") === "true",
    }),
  );
});

documentRoutes.post("/signed-url", async (c) => {
  const body = await c.req.json<{ bucket: string; path: string; expiresIn: number }>();
  await assertDocumentAccess({ bucket: body.bucket, filePath: body.path, operation: "read" });
  const result = await createDocumentDataUrl(body.path);
  return c.json({ signedUrl: result.signedUrl });
});

documentRoutes.delete("/", async (c) => {
  const body = await c.req.json<{ bucket: string; paths: string[] }>();
  await Promise.all(
    body.paths.map((filePath) =>
      assertDocumentAccess({ bucket: body.bucket, filePath, operation: "delete" }),
    ),
  );
  return c.json(await removeDocumentBlobs(body.paths));
});

documentRoutes.post("/cloudinary-image", async (c) => {
  // Reachable in the UI only from super_admin-gated screens, but the upload
  // itself targets shared org-wide Cloudinary assets — enforce the role here
  // rather than trusting the caller.
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin")) {
    return c.json({ message: "Unauthorized" }, 403);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ message: "Missing file" }, 400);
  }

  const folder = String(form.get("folder") ?? "rewards");
  const publicId = String(form.get("publicId") ?? `${folder}/${crypto.randomUUID()}`);

  return c.json(await uploadToCloudinary({ file, folder, publicId, resourceType: "image" }));
});
