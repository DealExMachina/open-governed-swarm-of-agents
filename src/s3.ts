import {
  S3Client,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30000;

let circuitFailures = 0;
let circuitOpenUntil = 0;

async function withCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD && now < circuitOpenUntil) {
    throw new Error("S3 circuit breaker open");
  }
  if (now >= circuitOpenUntil) {
    circuitFailures = 0;
  }
  try {
    const result = await fn();
    circuitFailures = 0;
    return result;
  } catch (e) {
    circuitFailures++;
    if (circuitFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
    throw e;
  }
}

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export function makeS3() {
  const endpoint = process.env.S3_ENDPOINT!;
  const region = process.env.S3_REGION || "us-east-1";

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
}

export async function s3GetText(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  return withCircuitBreaker(async () => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      return null;
    }
    const res: GetObjectCommandOutput = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const { Body } = res;
    if (!Body) return null;
    return streamToString(Body as Readable);
  });
}

export async function s3PutJson(
  s3: S3Client,
  bucket: string,
  key: string,
  data: unknown,
) {
  return withCircuitBreaker(() =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
      }),
    ),
  );
}

export async function s3PutText(
  s3: S3Client,
  bucket: string,
  key: string,
  body: string,
  contentType = "text/plain; charset=utf-8",
): Promise<void> {
  await withCircuitBreaker(() =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    ),
  );
}

export async function s3ListKeys(
  s3: S3Client,
  bucket: string,
  prefix: string,
  maxKeys: number = 1000,
): Promise<string[]> {
  return withCircuitBreaker(async () => {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    );
    return (res.Contents ?? []).map((c) => c.Key!).filter(Boolean);
  });
}
