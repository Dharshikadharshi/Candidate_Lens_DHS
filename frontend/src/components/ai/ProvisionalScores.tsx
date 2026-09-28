import React from 'react';
import type { DimensionProgress } from '../../types/ai';

const EVIDENCE_LABEL: Record<DimensionProgress['evidence_status'], string> = {
  not_enough_evidence: 'Not enough evidence',
  limited_evidence: 'Limited evidence',
  sufficient_evidence: 'Sufficient evidence',
};

interface ProvisionalScoresProps {
  dimensions: DimensionProgress[];
  provisional: boolean;
  compact?: boolean;
}

const ProvisionalScores: React.FC<ProvisionalScoresProps> = ({ dimensions, provisional, compact }) => (
  <div className="score-list" aria-label={provisional ? 'Provisional scores' : 'Scores'}>
    {provisional && (
      <div className="hint" style={{ marginBottom: 8 }}>
        Provisional — updates as answers are evaluated. Not a hiring recommendation.
      </div>
    )}
    {dimensions.map((d) => (
      <div key={d.dimension} className="score-row">
        <div className="score-row-head">
          <span className="score-label">{d.label}</span>
          <span className="score-value">
            {d.average !== null ? `${d.average.toFixed(1)} / 5` : <span className="hint">{EVIDENCE_LABEL.not_enough_evidence}</span>}
          </span>
        </div>
        <div className="score-bar" aria-hidden>
          <div className="score-bar-fill" style={{ width: d.average !== null ? `${(d.average / 5) * 100}%` : 0 }} />
        </div>
        <div className="score-meta">
          <span>{d.evaluated_answers} scored</span>
          {d.awaiting_evaluation > 0 && <span>{d.awaiting_evaluation} awaiting</span>}
          {d.needs_review > 0 && <span className="text-warn">{d.needs_review} need review</span>}
          {d.evaluation_failed > 0 && <span className="text-error">{d.evaluation_failed} failed</span>}
          {d.average !== null && <span>{EVIDENCE_LABEL[d.evidence_status]}</span>}
        </div>
        {!compact && d.latest_evidence && (
          <div className="score-evidence">
            <strong>{d.latest_evidence.question}:</strong> {d.latest_evidence.rationale}
            {d.latest_evidence.excerpt && <div className="evidence-quote">“{d.latest_evidence.excerpt}”</div>}
          </div>
        )}
      </div>
    ))}
  </div>
);

export default ProvisionalScores;
