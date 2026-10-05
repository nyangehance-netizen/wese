// Adds optional push-notification settings on top of app.json at build time.
// - EAS_PROJECT_ID: the Expo project ID (from `eas init` or expo.dev) that push tokens belong to.
// - google-services.json in this folder: Firebase config, needed for push on Android.
// Without them the app still builds; it just skips registering for push.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  if (projectId) config.extra = { ...config.extra, eas: { ...(config.extra?.eas || {}), projectId } };
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
