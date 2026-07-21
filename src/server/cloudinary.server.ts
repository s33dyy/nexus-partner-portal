import { createHash } from "node:crypto";

export type CloudinaryResourceType = "image" | "raw";

type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

type CloudinaryUploadResult = {
  public_id: string;
  secure_url: string;
  resource_type: CloudinaryResourceType;
  bytes: number;
  format?: string;
};

function getConfig(): CloudinaryConfig {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Missing Cloudinary environment variables");
  }

  return { cloudName, apiKey, apiSecret };
}

export function hasCloudinaryConfig(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
  );
}

function signParams(
  params: Record<string, string | number | boolean | undefined>,
  apiSecret: string,
) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
  return createHash("sha1").update(`${serialized}${apiSecret}`).digest("hex");
}

function buildUploadParams(input: {
  apiKey: string;
  apiSecret: string;
  publicId: string;
  folder?: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string | number | boolean | undefined> = {
    public_id: input.publicId,
    timestamp,
    overwrite: true,
    ...(input.folder ? { folder: input.folder } : {}),
  };

  return {
    timestamp,
    signature: signParams(params, input.apiSecret),
    apiKey: input.apiKey,
  };
}

export async function uploadToCloudinary(input: {
  file: File;
  publicId: string;
  resourceType: CloudinaryResourceType;
  folder?: string;
}): Promise<CloudinaryUploadResult> {
  const config = getConfig();
  const { timestamp, signature, apiKey } = buildUploadParams({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    publicId: input.publicId,
    folder: input.folder,
  });

  const form = new FormData();
  form.append("file", input.file);
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("public_id", input.publicId);
  form.append("overwrite", "true");
  if (input.folder) {
    form.append("folder", input.folder);
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${input.resourceType}/upload`,
    {
      method: "POST",
      body: form,
    },
  );
  const json = (await response.json()) as
    | CloudinaryUploadResult
    | { error?: { message?: string } }
    | undefined;

  if (!response.ok || !json || "error" in json) {
    const message = json && "error" in json ? json.error?.message : null;
    throw new Error(message ?? `Cloudinary upload failed (${response.status})`);
  }

  return json as CloudinaryUploadResult;
}

export async function deleteFromCloudinary(input: {
  publicId: string;
  resourceType: CloudinaryResourceType;
}) {
  const config = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    public_id: input.publicId,
    timestamp,
    invalidate: true,
  };
  const signature = signParams(params, config.apiSecret);
  const form = new FormData();
  form.append("public_id", input.publicId);
  form.append("timestamp", String(timestamp));
  form.append("invalidate", "true");
  form.append("api_key", config.apiKey);
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${input.resourceType}/destroy`,
    {
      method: "POST",
      body: form,
    },
  );
  const json = (await response.json()) as { result?: string; error?: { message?: string } };
  if (!response.ok || json.result === "error") {
    throw new Error(json.error?.message ?? `Cloudinary delete failed (${response.status})`);
  }

  return json;
}

export function buildCloudinaryMediaUrl(input: {
  publicId: string;
  resourceType: CloudinaryResourceType;
  format?: string | null;
}) {
  if (!hasCloudinaryConfig()) {
    return input.format
      ? `data:${input.resourceType}/${input.format}`
      : "data:application/octet-stream";
  }
  const { cloudName } = getConfig();
  const extension = input.format ? `.${input.format}` : "";
  return `https://res.cloudinary.com/${cloudName}/${input.resourceType}/upload/${input.publicId}${extension}`;
}
