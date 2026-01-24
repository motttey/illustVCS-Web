export default defineNuxtConfig({
  compatibilityDate: '2026-01-24',

  app: {
    head: {
      title: process.env.npm_package_name || '',
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
});
