import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { accessRole, auth, canEditWorkspace, type AccessRequest } from './access.js';
import { r2Config } from './config.js';
import { getPool } from './db/client.js';

const MAX_SIZE = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 600;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function client(): S3Client | null {
  const config = r2Config();
  return config ? new S3Client({ endpoint: config.endpoint, region: 'auto', credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) : null;
}

function validImage(contentType?: string, sizeBytes?: number): boolean {
  return Boolean(contentType && IMAGE_TYPES.has(contentType) && Number.isInteger(sizeBytes) && sizeBytes! > 0 && sizeBytes! <= MAX_SIZE);
}

async function workspaceAccess(request: AccessRequest, reply: FastifyReply, workspaceId: string, write = false): Promise<boolean> {
  if (!(await auth(request, reply))) return false;
  const role = await accessRole(request, workspaceId);
  if (!role) { await reply.code(404).send({ code: 'NOT_FOUND' }); return false; }
  if (write && !canEditWorkspace(role)) { await reply.code(403).send({ code: 'FORBIDDEN' }); return false; }
  return true;
}

export async function createAssetReadUrl(objectKey: string): Promise<string> {
  const config = r2Config(); const s3 = client();
  if (!config || !s3) throw new Error('STORAGE_NOT_CONFIGURED');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }), { expiresIn: SIGNED_URL_SECONDS });
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { workspaceId: string }; Body: { fileName?: string; contentType?: string; sizeBytes?: number } }>('/api/workspaces/:workspaceId/assets/presign', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const { fileName, contentType, sizeBytes } = request.body ?? {};
    if (!fileName || !validImage(contentType, sizeBytes)) return reply.code(400).send({ code: 'INVALID_IMAGE', message: '仅支持 JPEG、PNG、WebP、GIF 且不超过 10 MB 的图片' });
    const config = r2Config(); const s3 = client();
    if (!config || !s3) return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' });
    const assetId = randomUUID(); const objectKey = `workspaces/${request.params.workspaceId}/assets/${assetId}`;
    await getPool().query('INSERT INTO assets(id,object_key,original_name,content_type,size_bytes,status,created_by,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [assetId, objectKey, fileName, contentType, sizeBytes, 'pending', r.access!.id, request.params.workspaceId]);
    try {
      const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, ContentType: contentType }), { expiresIn: SIGNED_URL_SECONDS });
      return { assetId, objectKey, uploadUrl, expiresIn: SIGNED_URL_SECONDS };
    } catch (error) {
      await getPool().query("UPDATE assets SET status='failed', deleted_at=now() WHERE id=$1", [assetId]);
      throw error;
    }
  });

  app.post<{ Params: { workspaceId: string }; Body: { assetId?: string; objectKey?: string; originalName?: string; contentType?: string; sizeBytes?: number } }>('/api/workspaces/:workspaceId/assets/complete', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const { assetId, objectKey, originalName, contentType, sizeBytes } = request.body ?? {};
    if (!assetId || !objectKey || !originalName || !validImage(contentType, sizeBytes) || objectKey !== `workspaces/${request.params.workspaceId}/assets/${assetId}`) return reply.code(400).send({ code: 'INVALID_IMAGE', message: '图片元数据无效' });
    const config = r2Config(); const s3 = client();
    if (!config || !s3) return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' });
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }));
      if (head.ContentLength !== sizeBytes || (head.ContentType && head.ContentType !== contentType)) return reply.code(400).send({ code: 'INVALID_IMAGE', message: '上传图片与登记信息不一致' });
    } catch { return reply.code(400).send({ code: 'UPLOAD_NOT_FOUND', message: '未找到已上传图片' }); }
    const updated = await getPool().query("UPDATE assets SET original_name=$4, content_type=$5, size_bytes=$6, status='ready' WHERE id=$1 AND workspace_id=$2 AND created_by=$3 AND object_key=$7 AND status='pending' AND deleted_at IS NULL RETURNING id", [assetId, request.params.workspaceId, r.access!.id, originalName, contentType, sizeBytes, objectKey]);
    if (!updated.rowCount) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
    return { assetId, status: 'ready' };
  });

  app.get<{ Params: { workspaceId: string; assetId: string } }>('/api/workspaces/:workspaceId/assets/:assetId/url', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId))) return;
    const row = (await getPool().query("SELECT object_key FROM assets WHERE id=$1 AND workspace_id=$2 AND status='ready' AND deleted_at IS NULL", [request.params.assetId, request.params.workspaceId])).rows[0] as { object_key?: string } | undefined;
    if (!row?.object_key) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
    try { return { url: await createAssetReadUrl(row.object_key), expiresIn: SIGNED_URL_SECONDS }; }
    catch { return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' }); }
  });

  app.delete<{ Params: { workspaceId: string; assetId: string } }>('/api/workspaces/:workspaceId/assets/:assetId', async (request, reply) => {
    const r = request as AccessRequest;
    if (!(await workspaceAccess(r, reply, request.params.workspaceId, true))) return;
    const row = (await getPool().query("SELECT object_key FROM assets WHERE id=$1 AND workspace_id=$2 AND created_by=$3 AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM product_images WHERE asset_id=assets.id)", [request.params.assetId, request.params.workspaceId, r.access!.id])).rows[0] as { object_key?: string } | undefined;
    if (!row?.object_key) return reply.code(404).send({ code: 'ASSET_NOT_FOUND' });
    const config = r2Config(); const s3 = client();
    if (!config || !s3) return reply.code(503).send({ code: 'STORAGE_NOT_CONFIGURED', message: '图片存储尚未配置' });
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: row.object_key }));
    await getPool().query("UPDATE assets SET deleted_at=now(), status='deleted' WHERE id=$1", [request.params.assetId]);
    return { assetId: request.params.assetId, status: 'deleted' };
  });
}
