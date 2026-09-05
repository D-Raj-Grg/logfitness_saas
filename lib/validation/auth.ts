import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .toLowerCase()

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
})

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export const onboardingSchema = z.object({
  orgName: z
    .string()
    .trim()
    .min(2, 'Gym name must be at least 2 characters')
    .max(120, 'Gym name is too long'),
  branchName: z
    .string()
    .trim()
    .min(1, 'Give your first branch a name')
    .max(120, 'Branch name is too long'),
  ownerName: z
    .string()
    .trim()
    .min(1, 'Your name is required')
    .max(120, 'Name is too long'),
})

export type SignInInput = z.infer<typeof signInSchema>
export type SignUpInput = z.infer<typeof signUpSchema>
export type OnboardingInput = z.infer<typeof onboardingSchema>
