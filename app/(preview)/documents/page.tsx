import { InvoiceDocument } from '@/components/print/invoice-document'
import { ReceiptDocument } from '@/components/print/receipt-document'
import type { InvoiceForPrint, PaymentForPrint } from '@/lib/db/documents'

/**
 * Fixtures shaped from the real LOG Fitness data, so the numbers on screen are
 * numbers the gym has actually printed.
 */
const org: InvoiceForPrint['org'] = {
  name: 'Lord of Gyms & Fitness',
  legal_name: null,
  address: 'Kapur Complex, Hetauda',
  phone: '57591985',
  email: 'logfitnesshtd@gmail.com',
  pan_no: null,
  tax_note: null,
  invoice_terms: 'Fees once paid will not be refunded.',
  logo_path: null,
  currency: 'NPR',
  timezone: 'Asia/Kathmandu',
}

const member: InvoiceForPrint['member'] = {
  member_code: 'M00031',
  full_name: 'Shreesha Joshi',
  phone: '9807111148',
  email: null,
  address: null,
}

const branch: InvoiceForPrint['branch'] = {
  name: 'Hetauda',
  address: 'Kapur Complex, Hetauda',
  phone: '57591985',
}

type Membership = NonNullable<InvoiceForPrint['membership']>

function membership(over: Partial<Membership> = {}): Membership {
  return {
    plan_name: 'Gym + Cardio - 3 Months',
    plan_type: 'time',
    start_date: '2026-09-14',
    end_date: '2026-12-12',
    sessions_total: null,
    price_paisa: 660000,
    signup_fee_paisa: 0,
    signup_fee_waived_paisa: 50000,
    discount_paisa: 0,
    previous_membership_id: null,
    seller: { full_name: 'Ashish' },
    ...over,
  }
}

function invoice(over: Partial<InvoiceForPrint> = {}): InvoiceForPrint {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    org_id: '',
    branch_id: '',
    member_id: '',
    membership_id: '',
    invoice_no: 'INV000031',
    issued_on: '2026-09-10',
    subtotal_paisa: 660000,
    discount_paisa: 0,
    discount_reason: null,
    discount_note: null,
    total_paisa: 660000,
    paid_paisa: 0,
    due_paisa: 660000,
    status: 'unpaid',
    notes: null,
    created_at: '2026-09-10T10:00:00Z',
    updated_at: '2026-09-10T10:00:00Z',
    member,
    branch,
    org,
    membership: membership(),
    payments: [],
    ...over,
  } as InvoiceForPrint
}

const CASES: { title: string; node: React.ReactNode }[] = [
  {
    title: 'Invoice — unpaid, registration fee off (the real INV000031)',
    node: <InvoiceDocument invoice={invoice()} />,
  },
  {
    title: 'Invoice — paid, fee off AND a discount (both credits, the banner)',
    node: (
      <InvoiceDocument
        invoice={invoice({
          invoice_no: 'INV000027',
          subtotal_paisa: 390000,
          discount_paisa: 40000,
          discount_reason: 'festival',
          total_paisa: 350000,
          paid_paisa: 350000,
          due_paisa: 0,
          status: 'paid',
          membership: membership({
            plan_name: 'Cardio Only - 3 Months',
            price_paisa: 390000,
          }),
          payments: [
            {
              id: 'p1',
              kind: 'payment',
              amount_paisa: 350000,
              method: 'cash',
              reference_no: null,
              paid_at: '2026-09-09T05:00:00Z',
              collector: { full_name: 'Ashish' },
            },
          ],
        } as Partial<InvoiceForPrint>)}
      />
    ),
  },
  {
    title: 'Invoice — part paid, fee charged, discount (no fee-off line)',
    node: (
      <InvoiceDocument
        invoice={invoice({
          invoice_no: 'INV000012',
          subtotal_paisa: 300000,
          discount_paisa: 30000,
          discount_reason: 'other',
          discount_note: "Owner's cousin",
          total_paisa: 270000,
          paid_paisa: 200000,
          due_paisa: 70000,
          status: 'partial',
          membership: membership({
            plan_name: 'Gym + Cardio - 1 Month',
            price_paisa: 300000,
            signup_fee_paisa: 50000,
            signup_fee_waived_paisa: 0,
          }),
          payments: [
            {
              id: 'p1',
              kind: 'payment',
              amount_paisa: 200000,
              method: 'esewa',
              reference_no: 'ESW-771',
              paid_at: '2026-09-08T09:30:00Z',
              collector: { full_name: 'Ashish' },
            },
          ],
        } as Partial<InvoiceForPrint>)}
      />
    ),
  },
  {
    title: 'Invoice — renewal, fee off because it was paid on joining',
    node: (
      <InvoiceDocument
        invoice={invoice({
          invoice_no: 'INV000032',
          membership: membership({
            previous_membership_id: '00000000-0000-4000-8000-0000000000ff',
          }),
        } as Partial<InvoiceForPrint>)}
      />
    ),
  },
  {
    title: 'Receipt — a plain payment on a discounted sale',
    node: (
      <ReceiptDocument
        payment={
          {
            id: 'a1b2c3d4-0000-4000-8000-000000000000',
            kind: 'payment',
            amount_paisa: 350000,
            method: 'cash',
            reference_no: null,
            paid_at: '2026-09-09T05:00:00Z',
            reason: null,
            notes: null,
            org,
            member,
            branch,
            collector: { full_name: 'Ashish' },
            membership: {
              plan_name: 'Cardio Only - 3 Months',
              plan_type: 'time',
              start_date: '2026-09-14',
              end_date: '2026-12-12',
              signup_fee_waived_paisa: 50000,
            },
            invoice: {
              invoice_no: 'INV000027',
              total_paisa: 350000,
              paid_paisa: 350000,
              due_paisa: 0,
              status: 'paid',
              discount_paisa: 40000,
              discount_reason: 'festival',
            },
          } as unknown as PaymentForPrint
        }
      />
    ),
  },
  {
    title: 'Receipt — a reversal (money never received)',
    node: (
      <ReceiptDocument
        payment={
          {
            id: 'f9e8d7c6-0000-4000-8000-000000000000',
            kind: 'reversal',
            amount_paisa: -200000,
            method: 'cash',
            reference_no: null,
            paid_at: '2026-09-09T11:00:00Z',
            reason: 'Recorded as cash but the member never handed it over.',
            notes: null,
            org,
            member,
            branch,
            collector: { full_name: 'Ashish' },
            membership: null,
            invoice: {
              invoice_no: 'INV000012',
              total_paisa: 270000,
              paid_paisa: 0,
              due_paisa: 270000,
              status: 'unpaid',
              discount_paisa: 30000,
            },
          } as unknown as PaymentForPrint
        }
      />
    ),
  },
]

export default function DocumentPreviewPage() {
  return (
    <div className="flex flex-col items-center gap-10">
      {CASES.map((entry) => (
        <div key={entry.title} className="flex flex-col items-center gap-2">
          <p className="w-[210mm] max-w-full px-2 text-sm font-medium text-neutral-700 print:hidden">
            {entry.title}
          </p>
          <article className="doc-a4 shadow-sm print:shadow-none">{entry.node}</article>
        </div>
      ))}
    </div>
  )
}
