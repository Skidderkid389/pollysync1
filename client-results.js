// PollySync client results module
// Reads results through the secure, client-scoped database function.

(function () {
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function formatDate(value) {
    if (!value) return 'Not recorded';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not recorded';

    return date.toLocaleString('en-KE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Nairobi'
    }) + ' EAT';
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-KE');
  }

  window.loadPollySyncClientResults = async function () {
    const container =
      document.getElementById('clientResultsContent');

    if (!container) {
      console.log('Client results area is not connected yet.');
      return;
    }

    container.textContent = 'Loading campaign results...';

    try {
      const db = typeof pollySyncDB !== 'undefined'
        ? pollySyncDB
        : window.pollySyncDB;

      if (!db) {
        throw new Error('PollySync database connection is unavailable.');
      }

      const { data, error } = await db.rpc(
        'client_get_my_campaign_results'
      );

      if (error) throw error;

      const candidates = Array.isArray(data?.candidates)
        ? data.candidates
        : [];

      const reports = Array.isArray(data?.reports)
        ? data.reports
        : [];

      // A station contributes to rankings only when it has
      // exactly one non-cancelled report and that report is locked.
      const reportsPerStation = {};

      reports.forEach(report => {
        if (report.status === 'cancelled') return;

        reportsPerStation[report.station_id] =
          (reportsPerStation[report.station_id] || 0) + 1;
      });

      const eligibleReports = reports.filter(report =>
        report.status === 'locked' &&
        reportsPerStation[report.station_id] === 1
      );

      const totals = candidates.map(candidate => ({
        candidate_id: candidate.candidate_id,
        candidate_name: candidate.candidate_name,
        is_pollysync_client: candidate.is_pollysync_client,
        votes: 0
      }));

      const totalsById = new Map(
        totals.map(candidate => [
          candidate.candidate_id,
          candidate
        ])
      );

      eligibleReports.forEach(report => {
        const entries =
          report.candidate_votes?.candidates || [];

        entries.forEach(entry => {
          const candidate =
            totalsById.get(entry.candidate_id);

          if (candidate) {
            candidate.votes += Number(entry.votes || 0);
          }
        });
      });

      totals.sort((a, b) =>
        b.votes - a.votes ||
        a.candidate_name.localeCompare(b.candidate_name)
      );

      const totalValidVotes = totals.reduce(
        (sum, candidate) => sum + candidate.votes,
        0
      );

      const rankingHTML = totals.length
        ? totals.map((candidate, index) => {
            const share = totalValidVotes
              ? (candidate.votes / totalValidVotes) * 100
              : 0;

            return `
              <div class="tile">
                <strong>
                  ${index + 1}. ${escapeHTML(candidate.candidate_name)}
                </strong>
                ${candidate.is_pollysync_client
                  ? '<p><strong>Your campaign candidate</strong></p>'
                  : ''}
                <p>Votes: ${formatNumber(candidate.votes)}</p>
                <p>Share of counted candidate votes: ${share.toFixed(2)}%</p>
              </div>
            `;
          }).join('')
        : '<p>No contestants are registered for this contest yet.</p>';

      const reportsHTML = reports.length
        ? reports.map(report => {
            const status = String(
              report.status || 'unknown'
            ).toUpperCase();

            const hasConflict =
              report.status !== 'cancelled' &&
              reportsPerStation[report.station_id] > 1;

            const candidateLines = (
              report.candidate_votes?.candidates || []
            ).map(entry => {
              const candidate = totalsById.get(entry.candidate_id);
              const name = candidate?.candidate_name ||
                'Unmatched contestant';

              return `
                <p>
                  ${escapeHTML(name)}:
                  ${formatNumber(entry.votes)}
                </p>
              `;
            }).join('');

            return `
              <div class="tile">
                <strong>${escapeHTML(report.station_name)}</strong>
                <p>Status: ${escapeHTML(status)}</p>
                ${hasConflict
                  ? '<p class="notice">Multiple non-cancelled reports exist for this station. Excluded from rankings pending review.</p>'
                  : ''}
                <p>Registered voters: ${formatNumber(report.registered_voters)}</p>
                <p>Total votes recorded: ${formatNumber(report.total_votes)}</p>
                <p>Official form reference: ${escapeHTML(report.official_form_reference || 'Not provided')}</p>
                <p>Server received: ${escapeHTML(formatDate(report.server_received_at))}</p>
                ${report.locked_at
                  ? `<p>Report locked: ${escapeHTML(formatDate(report.locked_at))}</p>`
                  : ''}
                ${candidateLines}
              </div>
            `;
          }).join('')
        : '<p>No reports are available for paid, active stations yet.</p>';

      container.innerHTML = `
        <h4>Candidate Rankings</h4>
        <p class="muted">
          Rankings include locked reports from stations with
          no conflicting non-cancelled submissions.
        </p>
        <div class="tiles">
          <div class="tile">
            Stations counted
            <strong>${formatNumber(eligibleReports.length)}</strong>
          </div>
          <div class="tile">
            Candidate votes counted
            <strong>${formatNumber(totalValidVotes)}</strong>
          </div>
        </div>
        ${rankingHTML}
        <h4>Polling Station Reports</h4>
        ${reportsHTML}
        <p class="muted">
          These are PollySync reports, not official election
          certification. Conflicting reports are excluded from
          rankings pending review.
        </p>
      `;
    } catch (error) {
      console.error('Client results loading failed:', error);

      container.textContent =
        error.message ||
        'Could not load results. Please refresh and try again.';
    }
  };
})();