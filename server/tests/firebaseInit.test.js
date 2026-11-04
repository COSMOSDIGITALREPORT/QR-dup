'use strict';

require('./setup');
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  validateServiceAccount,
  resolveCredentials,
  isFirebaseConfigured,
  initFirebase,
  getFirestore,
  getFirebaseAdmin,
  closeFirebase,
} = require('../config/firebase');

describe('Firebase Configuration & Credential Validation', () => {
  const originalEnv = { ...process.env };
  let tempDir = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firebase-test-'));
    delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  afterEach(async () => {
    await closeFirebase();
    process.env = { ...originalEnv };
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validateServiceAccount', () => {
    it('rejects null, non-object, and array inputs', () => {
      assert.throws(() => validateServiceAccount(null), /must be a valid JSON object/);
      assert.throws(() => validateServiceAccount('string'), /must be a valid JSON object/);
      assert.throws(() => validateServiceAccount([1, 2]), /must be a valid JSON object/);
    });

    it('rejects missing or non-string project_id', () => {
      assert.throws(
        () => validateServiceAccount({ client_email: 'a@b.com', private_key: 'key' }),
        /missing a valid "project_id"/
      );
      assert.throws(
        () => validateServiceAccount({ project_id: 123, client_email: 'a@b.com', private_key: 'key' }),
        /missing a valid "project_id"/
      );
    });

    it('rejects missing or non-string client_email', () => {
      assert.throws(
        () => validateServiceAccount({ project_id: 'test-proj', private_key: 'key' }),
        /missing a valid "client_email"/
      );
    });

    it('rejects missing or non-string private_key', () => {
      assert.throws(
        () => validateServiceAccount({ project_id: 'test-proj', client_email: 'a@b.com' }),
        /missing a valid "private_key"/
      );
    });

    it('passes when project_id, client_email, and private_key are present strings', () => {
      assert.doesNotThrow(() =>
        validateServiceAccount({
          project_id: 'weighingqr',
          client_email: 'test@weighingqr.iam.gserviceaccount.com',
          private_key: 'dummy-key',
        })
      );
    });
  });

  describe('resolveCredentials & isFirebaseConfigured', () => {
    it('returns null and false when no credentials environment variables are set', () => {
      assert.strictEqual(resolveCredentials(), null);
      assert.strictEqual(isFirebaseConfigured(), false);
    });

    it('throws when FIREBASE_SERVICE_ACCOUNT_PATH file does not exist', () => {
      const nonExistent = path.join(tempDir, 'does-not-exist.json');
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH = nonExistent;

      assert.throws(() => resolveCredentials(), /file not found at/);
      assert.strictEqual(isFirebaseConfigured(), false);
    });

    it('throws when FIREBASE_SERVICE_ACCOUNT_PATH points to invalid JSON', () => {
      const corruptFile = path.join(tempDir, 'corrupt.json');
      fs.writeFileSync(corruptFile, '{ invalid-json');
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH = corruptFile;

      assert.throws(() => resolveCredentials(), /Failed to read\/parse/);
      assert.strictEqual(isFirebaseConfigured(), false);
    });

    it('resolves successfully from a valid service account JSON file on disk', () => {
      const validFile = path.join(tempDir, 'service-account.json');
      const mockCreds = {
        type: 'service_account',
        project_id: 'weighingqr-test',
        client_email: 'admin@weighingqr-test.iam.gserviceaccount.com',
        private_key: 'dummy-test-key-content',
      };
      fs.writeFileSync(validFile, JSON.stringify(mockCreds));
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH = validFile;

      assert.strictEqual(isFirebaseConfigured(), true);
      const resolved = resolveCredentials();
      assert.strictEqual(resolved.project_id, 'weighingqr-test');
      assert.strictEqual(resolved.client_email, 'admin@weighingqr-test.iam.gserviceaccount.com');
      assert.strictEqual(resolved.private_key, 'dummy-test-key-content');
    });

    it('resolves fallback from valid FIREBASE_SERVICE_ACCOUNT_JSON string', () => {
      const mockCreds = {
        project_id: 'weighingqr-json-test',
        client_email: 'json@weighingqr-test.iam.gserviceaccount.com',
        private_key: 'json-private-key',
      };
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(mockCreds);

      assert.strictEqual(isFirebaseConfigured(), true);
      const resolved = resolveCredentials();
      assert.strictEqual(resolved.project_id, 'weighingqr-json-test');
    });

    it('never leaks private key text in error messages', () => {
      const badFile = path.join(tempDir, 'bad-sa.json');
      fs.writeFileSync(badFile, JSON.stringify({ project_id: 'p' }));
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH = badFile;

      try {
        resolveCredentials();
        assert.fail('Should have thrown');
      } catch (err) {
        assert.doesNotMatch(err.message, /BEGIN PRIVATE KEY/);
        assert.match(err.message, /client_email/);
      }
    });
  });

  describe('initFirebase error handling', () => {
    it('throws a clear error when credentials are not configured', () => {
      assert.throws(
        () => initFirebase('test-app'),
        /Firebase credentials not configured\. Please set FIREBASE_SERVICE_ACCOUNT_PATH/
      );
    });
  });
});

