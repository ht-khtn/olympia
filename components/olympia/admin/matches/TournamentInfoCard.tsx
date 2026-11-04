
'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

type Props = {
    matchName: string | null
    tournamentName: string | null
    joinCode: string | null
    playerPassword?: string | null
    mcPassword?: string | null
}

export function TournamentInfoCard({
    matchName,
    tournamentName,
    joinCode,
    playerPassword,
    mcPassword,
}: Props) {
    const [showAllLinks, setShowAllLinks] = useState(false)
    const [copiedState, setCopiedState] = useState(false)

    const trimmedJoinCode = joinCode?.trim() ?? ''
    const encodedJoinCode = encodeURIComponent(trimmedJoinCode)

    const links = trimmedJoinCode
        ? {
            playerLink: `/olympia/client/game/${encodedJoinCode}`,
            mcLink: `/olympia/client/mc/${encodedJoinCode}`,
            guestLink: `/olympia/client/guest/${encodedJoinCode}`,
        }
        : null

    const generateContent = (
        includeAll: boolean,
        origin = '',
    ): string => {
        const base = origin.replace(/\/$/, '')
        const makeLink = (path: string) => `${base}${path}`

        const parts: string[] = []

        const header = [matchName, tournamentName]
            .filter(Boolean)
            .join(' | ')

        parts.push(header || 'Thông tin trận đấu')
        parts.push('----------')

        parts.push(`Mã phòng: ${trimmedJoinCode || '—'}`)
        parts.push('----------')

        parts.push(
            `Link thí sinh: ${links ? makeLink(links.playerLink) : '—'}`
        )

        if (playerPassword) {
            parts.push(`Mật khẩu thí sinh: ${playerPassword}`)
        }

        if (includeAll) {
            parts.push('----------')

            parts.push(
                `Link MC: ${links ? makeLink(links.mcLink) : '—'}`
            )

            if (mcPassword) {
                parts.push(`Mật khẩu MC: ${mcPassword}`)
            }

            parts.push('----------')

            parts.push(
                `Link khách: ${links ? makeLink(links.guestLink) : '—'}`
            )
        }

        return parts.join('\n')
    }

    const contentToDisplay = generateContent(showAllLinks)

    async function handleCopy() {
        const copyContent = generateContent(
            showAllLinks,
            window.location.origin,
        )

        try {
            await navigator.clipboard.writeText(copyContent)
        } catch {
            const textarea = document.createElement('textarea')
            textarea.value = copyContent
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }

        setCopiedState(true)
        toast.success('Đã sao chép nội dung')

        window.setTimeout(() => setCopiedState(false), 1500)
    }

    if (!trimmedJoinCode) {
        return (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Chưa có phòng live (join code). Hãy mở phòng trước để lấy thông tin.
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <Switch
                    checked={showAllLinks}
                    onCheckedChange={setShowAllLinks}
                    id="show-all-links"
                />

                <label
                    htmlFor="show-all-links"
                    className="cursor-pointer text-sm font-medium"
                >
                    Toàn bộ
                </label>
            </div>

            <div className="rounded-md border border-slate-300 bg-slate-50 p-4 font-mono text-sm whitespace-pre-wrap wrap-break-word text-slate-900">
                {contentToDisplay}
            </div>

            <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                className="w-full"
            >
                {copiedState ? (
                    <>
                        <Check className="mr-2 h-4 w-4" />
                        Đã sao chép
                    </>
                ) : (
                    <>
                        <Copy className="mr-2 h-4 w-4" />
                        Sao chép nội dung
                    </>
                )}
            </Button>
        </div>
    )
}
