'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { OlympiaAccountMenu } from '@/components/olympia/client/OlympiaAccountMenu'
import type { LiveSessionRow } from '@/types/olympia/game'

type PlayerPasswordGateClientProps = {
    session: LiveSessionRow
    userAlreadyVerified?: boolean
    children: React.ReactNode
}

export function PlayerPasswordGateClient({
    session,
    userAlreadyVerified = false,
    children,
}: PlayerPasswordGateClientProps) {
    const [isVerified, setIsVerified] = useState(userAlreadyVerified)
    const [loading, setLoading] = useState(!userAlreadyVerified)
    const [error, setError] = useState<string | null>(null)
    const attemptedJoinCode = useRef<string | null>(null)
    const router = useRouter()

    useEffect(() => {
        if (isVerified || attemptedJoinCode.current === session.join_code) return
        attemptedJoinCode.current = session.join_code

        const verifyAccess = async () => {
            try {
                const response = await fetch('/api/olympia/verify-player-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ joinCode: session.join_code }),
                })
                const result: unknown = await response.json().catch(() => null)
                if (!response.ok || !result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
                    const message =
                        result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
                            ? result.error
                            : 'Không thể xác thực quyền thí sinh.'
                    setError(message)
                    return
                }
                setError(null)
                setIsVerified(true)
                router.refresh()
            } catch (verificationError) {
                setError(verificationError instanceof Error ? verificationError.message : 'Không thể xác thực quyền thí sinh.')
            } finally {
                setLoading(false)
            }
        }

        void verifyAccess()
    }, [isVerified, router, session.join_code])

    if (isVerified) {
        return <>{children}</>
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-6 relative">
            <div className="absolute top-4 right-4">
                <OlympiaAccountMenu loginRedirectTo={`/olympia/client/game/${session.join_code}`} />
            </div>

            <div className="w-full max-w-md">
                <div className="text-center space-y-2">
                    <p className="text-xs uppercase tracking-widest text-slate-200">OLYMPIA</p>
                    <h1 className="text-2xl font-semibold">Xác thực thí sinh</h1>
                    <p className="text-sm text-slate-200">
                        Mã phòng: <span className="font-mono font-semibold text-white">{session.join_code}</span>
                    </p>
                </div>

                <div className="mt-6 space-y-4 text-center">
                    {loading ? (
                        <p className="text-sm text-slate-200">Đang xác minh tài khoản và tư cách thí sinh...</p>
                    ) : (
                        <p className="text-sm text-red-200">{error ?? 'Không thể xác thực quyền thí sinh.'}</p>
                    )}
                </div>
            </div>
        </div>
    )
}
