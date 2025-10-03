import test from 'node:test'
import assert from 'node:assert/strict'

import { objectEnumValues } from '@prisma/client/runtime/library'
import type { Prisma } from '@prisma/client'

import {
  coercePrismaJsonInput,
  type PrismaSanitizedJsonValue,
} from '../src/service/loanSettlement'

test('coercePrismaJsonInput produces Prisma-compatible metadata inputs', async (t) => {
  type OrderMetadata = Prisma.OrderUpdateInput['metadata']
  type LoanEntryMetadata = Prisma.LoanEntryUpdateInput['metadata']

  const mockPrisma = {
    order: {
      async update(args: { data: { metadata: OrderMetadata } }) {
        return args.data.metadata
      },
    },
    loanEntry: {
      async update(args: { data: { metadata: LoanEntryMetadata } }) {
        return args.data.metadata
      },
    },
  }

  const dbNullValue =
    objectEnumValues.instances.DbNull as unknown as PrismaSanitizedJsonValue
  const jsonNullValue =
    objectEnumValues.instances.JsonNull as unknown as PrismaSanitizedJsonValue
  const scalarValue: PrismaSanitizedJsonValue = 'metadata'
  const objectValue: PrismaSanitizedJsonValue = { foo: 'bar' }

  const scenarios = [
    ['db null metadata', dbNullValue],
    ['json null metadata', jsonNullValue],
    ['scalar metadata', scalarValue],
    ['object metadata', objectValue],
  ] as const

  for (const [label, sanitized] of scenarios) {
    await t.test(label, async () => {
      const orderResult = await mockPrisma.order.update({
        data: { metadata: coercePrismaJsonInput(sanitized) },
      })

      const loanEntryResult = await mockPrisma.loanEntry.update({
        data: { metadata: coercePrismaJsonInput(sanitized) },
      })

      assert.deepEqual(orderResult, sanitized)
      assert.deepEqual(loanEntryResult, sanitized)
    })
  }
})
