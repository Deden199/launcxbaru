require('dotenv/config')
const { prisma } = require('../src/core/prisma')

;(async () => {
  const res = await prisma.$runCommandRaw({
    update: 'Order',
    updates: [
      {
        q: {
          $or: [
            { isLoan: { $exists: true } },
            { loanAmount: { $exists: true } },
            { loanAt: { $exists: true } },
            { loanBy: { $exists: true } },
            { loanedAt: { $exists: true } },
          ],
        },
        u: { $unset: { isLoan: '', loanAmount: '', loanAt: '', loanBy: '', loanedAt: '' } },
        multi: true,
        upsert: false,
      },
    ],
    ordered: false,
  })
  console.log(res)
})()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
