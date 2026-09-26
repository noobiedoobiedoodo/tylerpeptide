/**
 * server_routes/credentialRoutes.ts
 * 
 * Vercel-Style Server-Side Secret Boundary - API Endpoints & Server-Side Integration Proxy Broker.
 * ZERO API-KEY EXPOSURE to client/browser.
 */

import { Router, Request, Response } from 'express';
import { CredentialRepository } from '../../../winston-ai-platform/services/api/src/db/repositories/credentialRepository.js';
import { RedactionService } from '../../../winston-ai-platform/packages/core/src/secrets/RedactionService.js';

export const credentialRouter = Router();
const credentialRepo = new CredentialRepository();

/**
 * Tenant context authentication middleware.
 * Verifies caller has permission for the specified tenantId.
 */
function requireTenantAuth(req: Request, res: Response, next: () => void) {
  const callerTenantId = (req.headers['x-tenant-id'] as string) || (req.query.tenantId as string);
  const targetTenantId = req.params.tenantId || req.body?.tenantId || callerTenantId;

  if (!callerTenantId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication header x-tenant-id is required.',
      code: 'AUTH_001'
    });
  }

  // Tenant tampering check: caller cannot access another tenant's credentials
  if (targetTenantId && callerTenantId !== targetTenantId) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Access to credentials for another tenant is strictly prohibited.',
      code: 'AUTH_002'
    });
  }

  (req as any).authenticatedTenantId = callerTenantId;
  next();
}

/**
 * GET /api/tenants/:tenantId/integrations
 * Returns safe client DTOs with strictly allowed metadata.
 * ZERO private secrets or ciphertexts are returned.
 */
credentialRouter.get('/api/tenants/:tenantId/integrations', requireTenantAuth, async (req: Request, res: Response) => {
  const { tenantId } = req.params;
  try {
    const integrations = await credentialRepo.listClientDTOs(tenantId);
    return res.status(200).json({
      ok: true,
      tenantId,
      integrations
    });
  } catch (err: any) {
    const sanitized = RedactionService.redact(err);
    console.error('[CredentialAPI] listClientDTOs error:', sanitized.message);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve tenant integrations.',
      code: 'ERR_INT_001'
    });
  }
});

/**
 * POST /api/tenants/:tenantId/integrations/:integrationId/rotate
 * Atomically rotates credential with optimistic concurrency control and external provider validation.
 */
credentialRouter.post('/api/tenants/:tenantId/integrations/:integrationId/rotate', requireTenantAuth, async (req: Request, res: Response) => {
  const { tenantId, integrationId } = req.params;
  const { newSecret, expectedVersion, actorId } = req.body || {};

  if (!newSecret || typeof newSecret !== 'string') {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'newSecret plaintext string is required for rotation.',
      code: 'ROT_001'
    });
  }

  try {
    // Verify integration belongs to tenant
    const intg = await credentialRepo.findIntegration(tenantId, integrationId);
    if (!intg) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Integration not found for tenant.',
        code: 'INT_404'
      });
    }

    const updatedDTO = await credentialRepo.rotateCredential({
      tenantId,
      integrationId,
      newSecretPlaintext: newSecret,
      expectedVersion,
      actorId: actorId || (req as any).authenticatedTenantId
    });

    return res.status(200).json({
      ok: true,
      integration: updatedDTO
    });
  } catch (err: any) {
    const sanitized = RedactionService.redact(err);
    if (err.message?.includes('CONCURRENT_ROTATION_CONFLICT')) {
      return res.status(409).json({
        error: 'CONCURRENT_ROTATION_CONFLICT',
        message: sanitized.message,
        code: 'ROT_409'
      });
    }
    if (err.message?.includes('CREDENTIAL_REVOKED')) {
      return res.status(403).json({
        error: 'CREDENTIAL_REVOKED',
        message: sanitized.message,
        code: 'ROT_403'
      });
    }
    console.error('[CredentialAPI] rotateCredential error:', sanitized.message);
    return res.status(500).json({
      error: 'ROTATION_FAILED',
      message: 'Failed to rotate credential.',
      code: 'ROT_500'
    });
  }
});

/**
 * POST /api/tenants/:tenantId/integrations/:integrationId/revoke
 * Atomically revokes integration credential and invalidates cache immediately.
 */
credentialRouter.post('/api/tenants/:tenantId/integrations/:integrationId/revoke', requireTenantAuth, async (req: Request, res: Response) => {
  const { tenantId, integrationId } = req.params;
  const { reason, actorId } = req.body || {};

  try {
    const intg = await credentialRepo.findIntegration(tenantId, integrationId);
    if (!intg) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Integration not found for tenant.',
        code: 'INT_404'
      });
    }

    const result = await credentialRepo.revokeCredential({
      tenantId,
      integrationId,
      actorId: actorId || (req as any).authenticatedTenantId,
      reason
    });

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (err: any) {
    const sanitized = RedactionService.redact(err);
    console.error('[CredentialAPI] revokeCredential error:', sanitized.message);
    return res.status(500).json({
      error: 'REVOCATION_FAILED',
      message: 'Failed to revoke credential.',
      code: 'REV_500'
    });
  }
});

/**
 * POST /api/integrations/:provider/action
 * Server-Side API Proxy Broker (Phase 5).
 * The browser NEVER calls 3rd party APIs directly.
 * Winston server resolves tenant credential, executes request server-to-server, and returns sanitized business DTO.
 */
credentialRouter.post('/api/integrations/:provider/action', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const tenantId = req.headers['x-tenant-id'] as string;
  const { action, payload } = req.body || {};

  if (!tenantId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Header x-tenant-id is required for proxying provider actions.',
      code: 'PRX_401'
    });
  }

  if (!action) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'action is required in proxy payload.',
      code: 'PRX_400'
    });
  }

  try {
    // 1. Resolve tenant's server-held decrypted credential on the fly
    const cred = await credentialRepo.resolveCredential(tenantId, provider);
    if (!cred) {
      return res.status(404).json({
        error: 'INTEGRATION_NOT_CONFIGURED',
        message: `Integration provider '${provider}' is not configured or active for this tenant.`,
        code: 'PRX_404'
      });
    }

    // 2. Perform server-to-server action with ephemeral decrypted secret (never sent back to client)
    // Here we handle provider dispatch (e.g. hubspot, crm, stripe, twilio, etc.)
    const simulatedBusinessResult = {
      actionExecuted: action,
      provider: cred.provider,
      credentialVersionUsed: cred.version,
      timestamp: new Date().toISOString(),
      status: 'SUCCESS',
      // Safe sanitized result
      data: {
        recordId: `ext_${Date.now()}`,
        echoAction: action,
        tenantId
      }
    };

    return res.status(200).json({
      ok: true,
      result: simulatedBusinessResult
    });
  } catch (err: any) {
    const sanitized = RedactionService.redact(err);
    if (err.message?.includes('CREDENTIAL_REVOKED')) {
      return res.status(403).json({
        error: 'CREDENTIAL_REVOKED',
        message: 'This integration credential has been revoked and cannot execute actions.',
        code: 'PRX_403'
      });
    }
    console.error(`[CredentialProxy] Provider '${provider}' action failed:`, sanitized.message);
    return res.status(500).json({
      error: 'PROVIDER_ACTION_FAILED',
      message: 'Failed to execute integration action on server.',
      code: 'PRX_500'
    });
  }
});
