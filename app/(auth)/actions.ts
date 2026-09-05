'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { signInSchema, signUpSchema } from '@/lib/validation/auth'

/**
 * Constrains the post-login destination to a path on this site. A bare
 * X
 * both begin with a slash and are read by browsers as protocol-relative URLs,
 * which turns the login form into an open redirect.
 */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : ''

  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/'
  }

  try {
    const placeholder = 'http://localhost'
    const resolved = new URL(next, placeholder)
    return resolved.origin === placeholder ? `${resolved.pathname}${resolved.search}` : '/'
  } catch {
    return '/'
  }
}

export type AuthFormState = {
  error?: string
  notice?: string
  fieldErrors?: Record<string, string[]>
}

export async function signIn(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Deliberately vague: distinguishing "no such account" from "wrong password"
    // hands an attacker a way to enumerate staff email addresses.
    return { error: 'Incorrect email or password.' }
  }

  redirect(safeNext(formData.get('next')))
}

export async function signUp(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp(parsed.data)

  if (error) {
    return { error: error.message }
  }

  if (!data.session) {
    return {
      notice: 'Check your inbox and confirm your email address to continue.',
    }
  }

  // The app shell decides where this account belongs: an invited staff member
  // is linked to their waiting row, a new owner is sent to onboarding.
  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
