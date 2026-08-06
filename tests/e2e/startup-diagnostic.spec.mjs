import { test, expect } from '@playwright/test'

test('startup diagnostic renders meaningful portal content', async ({ page }) => {
  const consoleMessages = []
  const failedRequests = []
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${error.message}`))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`))

  await page.route('**/.netlify/identity**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/settings')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disable_signup: false, autoconfirm: false, external: {} }) })
      return
    }
    if (url.pathname.endsWith('/user')) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_token' }) })
      return
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' })
  })

  await page.goto('/')
  await page.waitForTimeout(1500)
  const body = await page.locator('body').innerText()
  console.log('STARTUP_BODY:', JSON.stringify(body))
  console.log('STARTUP_CONSOLE:', JSON.stringify(consoleMessages))
  console.log('STARTUP_FAILED_REQUESTS:', JSON.stringify(failedRequests))
  await expect(page.locator('#root')).not.toBeEmpty()
})
