import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { allowedOrigins, r2Config } from './config.js';
import { getPool } from './db/client.js';

const MAX_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function client(): S3Client | null {
  const config = r2Config();
  return config ? new S3Client({ endpoint: config.endpoint, region: 'auto', credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) : null;
}

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  try { await request.jwtVerify(); return true; } catch { await reply.code(401).send({ code: 'UNAUTHORIZED', message: '请先登录' }); return false; }
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { fileName?: string; contentType?: string; sizeBytes?: number } }>('/api/assets/presign', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const { fileName, contentType, sizeBytes } = request.body ?? {};
    if (!fileName || !contentType || !IMAGE_TYPES.has(contentType) || !Number.isInteger(sizeBytes) || sizeBytes! <= 0 || sizeBytes! > MAX_SIZE) return reply.code(400).send({ code: 'INVALID_IMAGE', message: '仅支持不超过 10 MB 的图片' });
    const config = r2Config(); const s3 = client();
    if (!config || !s3) return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' });
    const assetId = randomUUID(); const objectKey = `assets/${assetId}`;
    const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, ContentType: contentType }), { expiresIn: 600 });
    return { assetId, objectKey, uploadUrl, expiresIn: 600, allowedOrigins: allowedOrigins() };
  });

  app.post<{ Body: { assetId?: string; objectKey?: string; originalName?: string; contentType?: string; sizeBytes?: number } }>('/api/assets/complete', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const { assetId, objectKey, originalName, contentType, sizeBytes } = request.body ?? {};
    if (!assetId || !objectKey || !originalName || !contentType || !IMAGE_TYPES.has(contentType) || !Number.isInteger(sizeBytes) || sizeBytes! <= 0 || sizeBytes! > MAX_SIZE) return reply.code(400).send({ code: 'INVALID_IMAGE', message: '图片元数据无效' });
    const user = request.user as { sub?: string };
    await getPool().query('INSERT INTO assets (id, object_key, original_name, content_type, size_bytes, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [assetId, objectKey, originalName, contentType, sizeBytes, 'ready', user.sub ?? 'unknown']);
    return { assetId, status: 'ready' };
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id/url', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const row = (await getPool().query('SELECT object_key FROM assets WHERE id = $1 AND deleted_at IS NULL', [request.params.id])).rows[0] as { object_key?: string } | undefined;
    const config = r2Config(); const s3 = client();
    if (!row?.object_key || !config || !s3) return reply.code(404).send({ code: 'ASSET_NOT_FOUND', message: '图片不存在' });
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: row.object_key }), { expiresIn: 600 }), expiresIn: 600 };
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    if (!(await authenticate(request, reply))) return;
    const row = (await getPool().query('SELECT object_key FROM assets WHERE id = $1 AND deleted_at IS NULL', [request.params.id])).rows[0] as { object_key?: string } | undefined;
    const config = r2Config(); const s3 = client();
    if (!row?.object_key || !config || !s3) return reply.code(404).send({ code: 'ASSET_NOT_FOUND', message: '图片不存在' });
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: row.object_key }));
    await getPool().query('UPDATE assets SET deleted_at = now(), status = $2 WHERE id = $1', [request.params.id, 'deleted']);
    return { assetId: request.params.id, status: 'deleted' };
  });
}
