import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gozar.games.android',
  appName: 'GOZAR GAMES',
  webDir: 'android-app/www',
  android: {
    allowMixedContent: false
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#080808',
      showSpinner: false
    }
  }
};

export default config;
