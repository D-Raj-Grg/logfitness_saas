import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<'/forgot-password'>) {
  const { error } = await searchParams
  return <ForgotPasswordForm expired={error === 'expired'} />
}
