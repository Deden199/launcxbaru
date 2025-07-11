// src/route/web.routes.ts
import { Router, Request, Response } from 'express'
import * as paymentService from '../service/payment'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const router = Router()

router.get('/create-order', async (req: Request, res: Response) => {
  try {
    const apiKey = String(req.query.apiKey || '')
    const amount = Number(req.query.amount || 0)
    if (!apiKey || isNaN(amount) || amount <= 0) {
      return res.status(400).send('Missing or invalid apiKey/amount')
    }

    const client = await prisma.partnerClient.findUnique({ where: { apiKey } })
    if (!client || !client.isActive) return res.status(401).send('Invalid apiKey')

    // const { orderId } = await paymentService.createOrder({
    //   userId: client.id,
    //   amount,
    // })

    

    const checkoutHosts = [
      'https://checkout1.launcx.com',
      'https://altcheckout.launcx.com',
      'https://payment.launcx.com',
      'https://c1.launcx.com',
    ]
    const host = checkoutHosts[Math.floor(Math.random() * checkoutHosts.length)]

    // 4) Bangun URL dengan path /order/:orderId
    // const checkoutUrl = `${host}/order/${orderId}`

    // 5) Redirect
    // return res.redirect(303, checkoutUrl)

  } catch (err: any) {
    console.error('[web/create-order]', err)
    return res.status(500).send(err.message || 'Order creation failed')
  }
})

export default router
