/**
 * Review API client
 * Translates: crates/review/src/api.rs
 */

export interface ReviewRequest {
  prNumber: number;
  repo: string;
  owner: string;
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  approved: boolean;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
  severity: 'info' | 'warning' | 'error';
}

export class ReviewApiClient {
  constructor(private baseUrl: string) {}

  async submitReview(request: ReviewRequest): Promise<ReviewResult> {
    // TODO: Implement API call
    throw new Error('Not implemented');
  }
}
