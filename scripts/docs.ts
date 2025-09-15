import express from 'express'
import fs from 'fs'
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yaml'

const app = express()

const genSpec = (title: string, apis: string[], out: string) => {
  const spec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: { title, version: '1.0.0' },
    },
    apis,
  })
  fs.mkdirSync('docs/api', { recursive: true })
  fs.writeFileSync(`docs/api/${out}`, YAML.stringify(spec))
  return spec
}

const paymentSpec = genSpec('Payment API', ['src/route/payment.routes.ts'], 'payment.yaml')
const withdrawalSpec = genSpec('Withdrawal API', ['src/route/withdrawals.routes.ts'], 'withdrawal.yaml')
const withdrawalS2SSpec = genSpec('Withdrawal S2S API', ['src/route/withdrawals.s2s.routes.ts'], 'withdrawal.s2s.yaml')

app.use('/docs/payment', swaggerUi.serveFiles(paymentSpec), swaggerUi.setup(paymentSpec))
app.use('/docs/withdrawal', swaggerUi.serveFiles(withdrawalSpec), swaggerUi.setup(withdrawalSpec))
app.use('/docs/withdrawal-s2s', swaggerUi.serveFiles(withdrawalS2SSpec), swaggerUi.setup(withdrawalS2SSpec))

const port = Number(process.env.DOCS_PORT) || 3001
app.listen(port, () => {
  console.log(`Docs at http://localhost:${port}/docs/payment and /docs/withdrawal`)
})
