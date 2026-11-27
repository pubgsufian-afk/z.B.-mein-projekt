import { defineConfig,devices } from '@playwright/test'
export default defineConfig({
 testDir:'./tests/e2e',testMatch:'portal-notifications-devices.spec.mjs',timeout:45000,expect:{timeout:12000},
 fullyParallel:false,retries:0,reporter:[['line']],
 use:{baseURL:'http://127.0.0.1:4173',serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npx http-server dist -p 4173 -a 127.0.0.1 -c-1',url:'http://127.0.0.1:4173',reuseExistingServer:false,timeout:30000},
 projects:[
  {name:'desktop-chrome',use:{...devices['Desktop Chrome']}},
  {name:'iphone-15-safari-webkit',use:{...devices['iPhone 15'],browserName:'webkit'}},
  {name:'samsung-galaxy-s9-chromium-dark',use:{...devices['Galaxy S9+'],browserName:'chromium',colorScheme:'dark'}},
 ],
})
