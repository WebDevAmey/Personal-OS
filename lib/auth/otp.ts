// lib/auth/otp.ts
import bcrypt from 'bcrypt';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';
import type { VerificationType } from '@/lib/generated/prisma/client';

const resend = new Resend(process.env.RESEND_API_KEY);
const OTP_TTL_MS = 10 * 60 * 1000;

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueOtp(email: string, type: VerificationType, subject: string): Promise<void> {
  const code = generateOtp();
  const otpHash = await bcrypt.hash(code, 10);

  await prisma.verificationToken.create({
    data: { email, type, otpHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  await resend.emails.send({
    from: 'Personal OS <noreply@personal-os.app>',
    to: email,
    subject,
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
  });
}

export async function sendSignUpOtp(email: string): Promise<void> {
  await issueOtp(email, 'SIGN_UP', 'Verify your Personal OS account');
}

export async function sendPasswordResetOtp(email: string): Promise<void> {
  await issueOtp(email, 'PASSWORD_RESET', 'Reset your Personal OS password');
}
