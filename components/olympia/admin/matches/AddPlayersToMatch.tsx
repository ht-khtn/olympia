'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

type Participant = {
    user_id: string
    contestant_code: string | null
    display_name?: string | null
    role?: string | null
    class_name?: string | null | Array<{ class_name: string | null }>
}

type MatchPlayer = {
    id: string
    participant_id: string
    seat_index: number
    match_id: string
}

type CreatedMatchPlayer = {
    id: string
    match_id: string
    participant_id: string
    seat_index: number
    display_name: string | null
}

function isCreatedMatchPlayer(value: unknown): value is CreatedMatchPlayer {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return (
        typeof record.id === 'string' &&
        typeof record.match_id === 'string' &&
        typeof record.participant_id === 'string' &&
        typeof record.seat_index === 'number' &&
        (typeof record.display_name === 'string' || record.display_name === null)
    )
}

interface AddPlayersToMatchProps {
    matchId: string
    availableParticipants: Participant[]
    currentPlayers: MatchPlayer[]
    onAddSuccess?: () => void
}

export function AddPlayersToMatch({
    matchId,
    availableParticipants,
    currentPlayers,
    onAddSuccess,
}: AddPlayersToMatchProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [selectedParticipant, setSelectedParticipant] = useState<string>('')
    const [selectedSeat, setSelectedSeat] = useState<string>('')
    const [isLoading, setIsLoading] = useState(false)

    // Get list of already assigned participants (filter out nulls)
    const assignedParticipantIds = new Set(
        currentPlayers
            .map((p) => p.participant_id)
            .filter((id): id is string => Boolean(id))
    )

    const isContestantRole = (role: string | null | undefined) =>
        role === null || role === undefined || role === 'contestant'

    const unassignedParticipants = availableParticipants.filter((p) => {
        if (!isContestantRole(p.role)) {
            return false
        }
        return !assignedParticipantIds.has(p.user_id)
    })

    // Get occupied seats
    const occupiedSeats = new Set(currentPlayers.map((p) => p.seat_index))
    const availableSeats = [1, 2, 3, 4].filter((s) => !occupiedSeats.has(s))

    async function handleAddPlayer() {
        if (!selectedParticipant || !selectedSeat) {
            toast.error('Vui lòng chọn thí sinh và ghế')
            return
        }

        // Capture participant info locally so we can dispatch it after successful insert
        const participantInfo = availableParticipants.find((p) => p.user_id === selectedParticipant) ?? null

        setIsLoading(true)
        try {
            const response = await fetch('/api/olympia/match-players', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId,
                    participantId: selectedParticipant,
                    seatIndex: parseInt(selectedSeat, 10),
                }),
            })

            const result = await response.json()
            if (!response.ok) {
                toast.error(result.error || 'Không thể thêm thí sinh')
                return
            }

            toast.success('Đã thêm thí sinh vào trận')
            setSelectedParticipant('')
            setSelectedSeat('')
            setIsOpen(false)
            onAddSuccess?.()

            // Try to update client components without full page reload by
            // dispatching a custom event with the created player data and participant info.
            const created = isCreatedMatchPlayer(result) ? result : null
            if (created && typeof window !== 'undefined') {
                const detail = { ...created, participantInfo }
                window.dispatchEvent(new CustomEvent('olympia:player-added', { detail }))
            }
        } catch (error) {
            console.error('[AddPlayersToMatch]', error)
            toast.error('Lỗi khi thêm thí sinh')
        } finally {
            setIsLoading(false)
        }
    }

    if (unassignedParticipants.length === 0) {
        return (
            <Button disabled size="sm">
                Tất cả thí sinh đã gán
            </Button>
        )
    }

    return (
        <>
            <Button onClick={() => setIsOpen(true)} size="sm">
                + Thêm thí sinh
            </Button>

            <Dialog
                open={isOpen}
                onOpenChange={(nextOpen) => {
                    setIsOpen(nextOpen)
                    if (!nextOpen) {
                        setSelectedParticipant('')
                        setSelectedSeat('')
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Thêm thí sinh vào trận</DialogTitle>
                        <DialogDescription>Chọn thí sinh chưa được gán và ghế trống</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-2">Chọn thí sinh</label>
                            <Select value={selectedParticipant} onValueChange={setSelectedParticipant}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Chọn thí sinh..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unassignedParticipants.map((p) => {
                                        const classInfo = Array.isArray(p.class_name)
                                            ? (p.class_name[0]?.class_name || '')
                                            : (p.class_name || '')

                                        const code = p.contestant_code ?? '—'
                                        const name = p.display_name ?? p.user_id
                                        const cls = classInfo || '—'

                                        const displayText = `${code} - ${name} - ${cls}`

                                        return (
                                            <SelectItem key={p.user_id} value={p.user_id}>
                                                {displayText}
                                            </SelectItem>
                                        )
                                    })}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">Chọn ghế</label>
                            <Select value={selectedSeat} onValueChange={setSelectedSeat}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Chọn ghế..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableSeats.map((seat) => (
                                        <SelectItem key={seat} value={String(seat)}>
                                            Ghế {seat}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex gap-2 justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsOpen(false)}
                                disabled={isLoading}
                            >
                                Hủy
                            </Button>
                            <Button
                                onClick={handleAddPlayer}
                                disabled={!selectedParticipant || !selectedSeat || isLoading}
                            >
                                {isLoading ? 'Đang thêm…' : 'Thêm thí sinh'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
