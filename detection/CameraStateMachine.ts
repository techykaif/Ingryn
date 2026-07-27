/**
 * Camera Detection State Machine
 *
 * States:
 *   IDLE → SEARCHING → POSSIBLE_INGREDIENT → CONFIRMED → CAPTURING → PROCESSING
 *
 * Stable detection: confidence must remain ≥85% for 1000ms
 * continuously before transitioning to CONFIRMED.
 */

export type DetectionState =
  | 'IDLE'
  | 'SEARCHING'
  | 'POSSIBLE_INGREDIENT'
  | 'CONFIRMED'
  | 'CAPTURING'
  | 'PROCESSING'

export type DetectionClassification =
  | 'INGREDIENTS'
  | 'NUTRITION'
  | 'BARCODE'
  | 'UNKNOWN'

export type DetectionEvent =
  | { type: 'START_SCANNING' }
  | { type: 'DETECTION_RESULT'; classification: DetectionClassification; confidence: number }
  | { type: 'STABLE_CONFIRMED' }
  | { type: 'CAPTURE_START' }
  | { type: 'CAPTURE_COMPLETE' }
  | { type: 'PROCESSING_COMPLETE' }
  | { type: 'RESET' }

/** Thresholds */
const CONFIRM_THRESHOLD = 0.85
const POSSIBLE_THRESHOLD = 0.50
const STABLE_DURATION_MS = 1000

export type StateChangeCallback = (
  newState: DetectionState,
  prevState: DetectionState,
  context: StateMachineContext
) => void

export type StateMachineContext = {
  classification: DetectionClassification
  confidence: number
  /** Guidance message to display on overlay */
  guidanceMessage: string
}

export class CameraStateMachine {
  private _state: DetectionState = 'IDLE'
  private _context: StateMachineContext = {
    classification: 'UNKNOWN',
    confidence: 0,
    guidanceMessage: '',
  }

  /** Timestamp when confidence first exceeded CONFIRM_THRESHOLD */
  private stableStartTime: number | null = null
  private onChangeCallback: StateChangeCallback | null = null

  get state(): DetectionState {
    return this._state
  }

  get context(): StateMachineContext {
    return { ...this._context }
  }

  /** Register a listener for state changes. */
  onChange(cb: StateChangeCallback): void {
    this.onChangeCallback = cb
  }

  /** Process an event and transition state. Returns the new state. */
  transition(event: DetectionEvent): DetectionState {
    const prev = this._state

    switch (event.type) {
      case 'START_SCANNING':
        this.transitionTo('SEARCHING')
        this._context.guidanceMessage = 'Point at ingredient list'
        break

      case 'DETECTION_RESULT':
        this.handleDetectionResult(event.classification, event.confidence)
        break

      case 'STABLE_CONFIRMED':
        if (this._state === 'POSSIBLE_INGREDIENT') {
          this.transitionTo('CONFIRMED')
          this._context.guidanceMessage = 'Ingredient list detected!'
        }
        break

      case 'CAPTURE_START':
        if (this._state === 'CONFIRMED') {
          this.transitionTo('CAPTURING')
          this._context.guidanceMessage = 'Capturing...'
        }
        break

      case 'CAPTURE_COMPLETE':
        if (this._state === 'CAPTURING') {
          this.transitionTo('PROCESSING')
          this._context.guidanceMessage = 'Processing...'
        }
        break

      case 'PROCESSING_COMPLETE':
        this.transitionTo('IDLE')
        this.resetContext()
        break

      case 'RESET':
        this.transitionTo('IDLE')
        this.resetContext()
        break
    }

    if (prev !== this._state && this.onChangeCallback) {
      this.onChangeCallback(this._state, prev, this.context)
    }

    return this._state
  }

  /**
   * Check if the detection has been stable long enough to auto-confirm.
   * Call this on each detection tick. Returns true if stable duration exceeded.
   */
  checkStableDetection(confidence: number): boolean {
    const now = Date.now()

    if (confidence >= CONFIRM_THRESHOLD) {
      if (this.stableStartTime === null) {
        this.stableStartTime = now
      }
      return now - this.stableStartTime >= STABLE_DURATION_MS
    }

    // Confidence dropped — reset timer
    this.stableStartTime = null
    return false
  }

  /** Reset state machine to IDLE. */
  reset(): void {
    this.transition({ type: 'RESET' })
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private handleDetectionResult(
    classification: DetectionClassification,
    confidence: number
  ): void {
    this._context.classification = classification
    this._context.confidence = confidence

    // Don't change state once we're capturing/processing
    if (this._state === 'CAPTURING' || this._state === 'PROCESSING') return

    if (classification === 'NUTRITION') {
      this.transitionTo('SEARCHING')
      this._context.guidanceMessage =
        'This looks like the Nutrition Facts table. Please scan the Ingredients section.'
      this.stableStartTime = null
      return
    }

    if (classification === 'BARCODE') {
      this.transitionTo('SEARCHING')
      this._context.guidanceMessage =
        'Barcode detected. Please scan the Ingredients list.'
      this.stableStartTime = null
      return
    }

    if (classification === 'INGREDIENTS') {
      // Check stable detection
      if (this.checkStableDetection(confidence)) {
        this.transitionTo('CONFIRMED')
        this._context.guidanceMessage = 'Ingredient list detected!'
      } else {
        this.transitionTo('POSSIBLE_INGREDIENT')
        this._context.guidanceMessage = 'Hold steady...'
      }
      return
    }

    // UNKNOWN
    if (confidence >= POSSIBLE_THRESHOLD) {
      this.transitionTo('POSSIBLE_INGREDIENT')
      this._context.guidanceMessage = 'Possible ingredient list. Hold steady...'
      this.stableStartTime = null
    } else {
      this.transitionTo('SEARCHING')
      this._context.guidanceMessage = 'Point at ingredient list'
      this.stableStartTime = null
    }
  }

  private transitionTo(state: DetectionState): void {
    this._state = state
  }

  private resetContext(): void {
    this._context = {
      classification: 'UNKNOWN',
      confidence: 0,
      guidanceMessage: '',
    }
    this.stableStartTime = null
  }
}
