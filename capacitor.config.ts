// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.codoc.privatewalks',
  appName: 'Приватные прогулки',
  webDir: 'dist',
  server: {
    // https-схема для origin — нужно для CORS и service worker
    androidScheme: 'https',
  },
  android: {
    // Разрешаем http к локальной сети при разработке (не для прода)
    allowMixedContent: false,
  },
};

export default config;