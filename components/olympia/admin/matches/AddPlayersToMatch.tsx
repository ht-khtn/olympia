'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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

type Assignment = {
    participantId: string
    seatIndex: string
}

interface AddPlayersToMatchProps {
    matchId: string
    availableParticipants: Participant[]
    currentPlayers: MatchPlayer[]
    onAddSuccess?: () => void
}

function isContestantRole(role: string | null | undefined) {
    return role === null || role === undefined || role === 'contestant'
}

function participantLabel(participant: Participant) {
    const classInfo = Array.isArray(participant.class_name)
        ? (participant.class_name[0]?.class_name || '')
        : (participant.class_name || '')
    return `${participant.contestant_code ?? '—'} - ${participant.display_name ?? participant.user_id} - ${classInfo || '—'}`
}

export function AddPlayersToMatch({
    matchId,
    availableParticipants,
    currentPlayers,
    onAddSuccess,
}: AddPlayersToMatchProps) {
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [hasHydrated, setHasHydrated] = useState(false)

    useEffect(() => {
        setHasHydrated(true)
    }, [])

    const assignedParticipantIds = new Set(currentPlayers.map((player) => player.participant_id))
    const occupiedSeats = new Set(currentPlayers.map((player) => player.seat_index))
    const unassignedParticipants = availableParticipants.filter(
        (participant) => isContestantRole(participant.role) && !assignedParticipantIds.has(participant.user_id),
    )
    const availableSeats = [1, 2, 3, 4].filter((seat) => !occupiedSeats.has(seat))
    const [assignments, setAssignments] = useState<Assignment[]>(
        availableSeats.map((seat) => ({ participantId: '', seatIndex: String(seat) })),
    )

    const openDialog = () => {
        setAssignments(availableSeats.map((seat) => ({ participantId: '', seatIndex: String(seat) })))
        setIsOpen(true)
    }

    const closeDialog = () => {
        if (isLoading) return
        setIsOpen(false)
    }

    const updateAssignment = (index: number, patch: Partial<Assignment>) => {
        setAssignments((current) => current.map((assignment, assignmentIndex) =>
            assignmentIndex === index ? { ...assignment, ...patch } : assignment,
        ))
    }

    const isValid = assignments.length > 0
        && assignments.every((assignment) => assignment.participantId && assignment.seatIndex)
        && new Set(assignments.map((assignment) => assignment.participantId)).size === assignments.length
        && new Set(assignments.map((assignment) => assignment.seatIndex)).size === assignments.length

    async function handleAddPlayers() {
        if (!isValid) {
            toast.error('Vui lòng chọn thí sinh và ghế khác nhau cho tất cả các dòng')
            return
        }

        setIsLoading(true)
        try {
            const response = await fetch('/api/olympia/match-players', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId,
                    players: assignments.map((assignment) => ({
                        participantId: assignment.participantId,
                        seatIndex: Number(assignment.seatIndex),
                    })),
                }),
            })
            const result: unknown = await response.json()
            if (!response.ok) {
                const error = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : 'Không thể thêm thí sinh'
                toast.error(error)
                return
            }

            toast.success('Đã thêm thí sinh vào trận')
            setIsOpen(false)
            onAddSuccess?.()
            router.refresh()
        } catch {
            toast.error('Lỗi khi thêm thí sinh')
        } finally {
            setIsLoading(false)
        }
    }

    if (!hasHydrated) {
        return (
            <Button disabled size="sm">
                Đang tải…
            </Button>
        )
    }

    if (unassignedParticipants.length === 0 || availableSeats.length === 0) {
        return (
            <Button disabled size="sm">
                {availableSeats.length === 0 ? 'Đã đủ 4 thí sinh' : 'Tất cả thí sinh đã gán'}
            </Button>
        )
    }

    return (
        <>
            <Button onClick={openDialog} size="sm">
                + Thêm thí sinh
            </Button>

            <Dialog open={isOpen} onOpenChange={(open) => { if (open) openDialog(); else closeDialog() }}>
                <DialogContent className="w-[calc(100%-2rem)] max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Thêm thí sinh vào trận</DialogTitle>
                        <DialogDescription>
                            Chọn thí sinh và xác nhận ghế cho các vị trí còn trống.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        {/* Header */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '32px minmax(0, 1fr) 105px',
                                alignItems: 'center',
                                columnGap: '8px',
                            }}
                            className="border-b pb-2 text-xs font-medium text-muted-foreground"
                        >
                            <span>#</span>
                            <span>Thí sinh</span>
                            <span>Ghế</span>
                        </div>

                        {/* Danh sách thí sinh */}
                        {assignments.map((assignment, index) => {
                            const selectedElsewhere = new Set(
                                assignments
                                    .filter((_, assignmentIndex) => assignmentIndex !== index)
                                    .map((item) => item.participantId)
                                    .filter(Boolean),
                            )

                            const seatsSelectedElsewhere = new Set(
                                assignments
                                    .filter((_, assignmentIndex) => assignmentIndex !== index)
                                    .map((item) => item.seatIndex)
                                    .filter(Boolean),
                            )

                            const participantOptions = unassignedParticipants.filter(
                                (participant) =>
                                    participant.user_id === assignment.participantId ||
                                    !selectedElsewhere.has(participant.user_id),
                            )

                            const seatOptions = availableSeats.filter(
                                (seat) =>
                                    String(seat) === assignment.seatIndex ||
                                    !seatsSelectedElsewhere.has(String(seat)),
                            )

                            return (
                                <div
                                    key={index}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '32px minmax(0, 1fr) 105px',
                                        alignItems: 'center',
                                        columnGap: '8px',
                                    }}
                                >
                                    {/* Số thứ tự */}
                                    <span className="text-sm font-medium text-muted-foreground">
                                        {index + 1}
                                    </span>

                                    {/* Chọn thí sinh */}
                                    <div className="min-w-0">
                                        <Select
                                            value={assignment.participantId}
                                            onValueChange={(value) =>
                                                updateAssignment(index, { participantId: value })
                                            }
                                            disabled={isLoading}
                                        >
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue placeholder="Chọn thí sinh..." />
                                            </SelectTrigger>

                                            <SelectContent>
                                                {participantOptions.map((participant) => (
                                                    <SelectItem
                                                        key={participant.user_id}
                                                        value={participant.user_id}
                                                    >
                                                        {participantLabel(participant)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* Chọn ghế */}
                                    <div className="w-[105px]">
                                        <Select
                                            value={assignment.seatIndex}
                                            onValueChange={(value) =>
                                                updateAssignment(index, { seatIndex: value })
                                            }
                                            disabled={isLoading}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Ghế..." />
                                            </SelectTrigger>

                                            <SelectContent>
                                                {seatOptions.map((seat) => (
                                                    <SelectItem
                                                        key={seat}
                                                        value={String(seat)}
                                                    >
                                                        Ghế {seat}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            )
                        })}

                        {/* Footer */}
                        <div className="flex items-center justify-between gap-3 pt-3">
                            <span className="text-sm text-muted-foreground">
                                {assignments.filter((assignment) => assignment.participantId).length}
                                /{assignments.length} thí sinh
                            </span>

                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={closeDialog}
                                    disabled={isLoading}
                                >
                                    Hủy
                                </Button>

                                <Button
                                    type="button"
                                    onClick={handleAddPlayers}
                                    disabled={!isValid || isLoading}
                                >
                                    {isLoading ? 'Đang thêm…' : 'Thêm thí sinh'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
