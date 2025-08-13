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

app.use('/docs/payment', swaggerUi.serve, swaggerUi.setup(paymentSpec))
app.use('/docs/withdrawal', swaggerUi.serve, swaggerUi.setup(withdrawalSpec))

const port = Number(process.env.DOCS_PORT) || 3001
app.listen(port, () => {
  console.log(`Docs at http://localhost:${port}/docs/payment and /docs/withdrawal`)
})
