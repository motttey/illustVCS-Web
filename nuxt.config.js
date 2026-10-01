export default defineNuxtConfig({
  compatibilityDate: '2026-01-24',

  app: {
    head: {
      title: 'IllustVCS - A Version Control System for Illustrators',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: process.env.npm_package_description || '' }
      ],
      link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }]
    }
  },

  css: ['bootstrap/dist/css/bootstrap.css'],

  modules: ['@bootstrap-vue-next/nuxt'],

  bootstrapVueNext: {
    composables: {
      all: true,
      // These two exports exist only in the shared composables entry point in 0.42.0.
      useScrollLock: false,
      useOrchestratorRegistry: false
    }
  },

  vite: {
    optimizeDeps: {
      include: [
        'bootstrap-vue-next',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'crypto-js/sha256',
        'd3',
        'd3-dag',
        'pixi.js',
      ]
    }
  }
});
