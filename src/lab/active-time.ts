/** Counts foreground work between checks; hidden tabs do not inflate an attempt. */
export class ActiveTime {
  private total = 0
  private since: number | undefined
  constructor(now: number, visible: boolean) { this.since = visible ? now : undefined }
  visibility(now: number, visible: boolean) {
    if (this.since !== undefined) this.total += Math.max(0, now - this.since)
    this.since = visible ? now : undefined
  }
  take(now: number, visible: boolean) {
    this.visibility(now, visible)
    const value = Math.round(this.total)
    this.total = 0
    return value
  }
}
