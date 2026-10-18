// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the heat pumps of the account.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // OAuth2: the Connect button of the configuration, then Weheat's return to Gladys.
  gladys.onOAuthAuthorizeUrl((key, redirectUri) => app.oauthAuthorizeUrl(key, redirectUri));
  gladys.onOAuthCallback((key, params) => app.oauthCallback(key, params));

  // Configuration screen buttons: the pasted return address, the test.
  gladys.onAction(ACTIONS.FINISH_SIGN_IN, (fields) => app.finishSignIn(fields));
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  gladys.on('connected', async () => {
    try {
      await app.connected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
