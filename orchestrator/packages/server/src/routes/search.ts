/**
 * Multi-repository search routes
 * Translates: crates/server/src/routes/search.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { RepoRepository } from '@orchestrator/db';

// Types
export interface SearchResult {
  repoId: string;
  repoName: string;
  path: string;
  line?: number;
  column?: number;
  content?: string;
  matchType: 'filename' | 'content';
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

export type SearchMode = 'filename' | 'content' | 'symbol';

const MAX_RESULTS = 1000;
const MAX_CONTENT_LENGTH = 500;

export const searchRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new RepoRepository(db());

  // GET /api/search - Search across multiple repositories
  fastify.get<{
    Querystring: {
      q: string;
      repo_ids?: string;
      mode?: SearchMode;
      case_sensitive?: boolean;
      whole_word?: boolean;
      regex?: boolean;
      include?: string;
      exclude?: string;
      max_results?: number;
    };
  }>('/search', async (request, reply) => {
    const {
      q,
      repo_ids,
      mode = 'filename',
      case_sensitive = false,
      whole_word = false,
      regex = false,
      include,
      exclude,
      max_results = MAX_RESULTS
    } = request.query;

    if (!q || q.trim().length === 0) {
      return reply.status(400).send({ error: 'Query is required' });
    }

    // Parse repository IDs
    const repoIdList = repo_ids?.split(',').filter(Boolean) ?? [];

    if (repoIdList.length === 0) {
      return reply.status(400).send({ error: 'At least one repository ID is required' });
    }

    // Get repositories from DB
    const repoRepository = getRepo();
    const foundRepos = repoRepository.findByIds(repoIdList);
    const repos = foundRepos.map(r => ({ id: r.id, repo: r }));

    if (repos.length === 0) {
      return reply.status(404).send({ error: 'No valid repositories found' });
    }

    const allResults: SearchResult[] = [];
    let truncated = false;

    for (const { id: repoId, repo } of repos) {
      if (allResults.length >= max_results) {
        truncated = true;
        break;
      }

      const remainingSlots = max_results - allResults.length;
      const repoResults = searchInRepo(
        repo.path,
        repoId,
        repo.name,
        q,
        mode,
        {
          caseSensitive: case_sensitive,
          wholeWord: whole_word,
          regex,
          include,
          exclude,
          maxResults: remainingSlots
        }
      );

      allResults.push(...repoResults);

      if (repoResults.length >= remainingSlots) {
        truncated = true;
      }
    }

    const response: SearchResponse = {
      query: q,
      mode,
      results: allResults,
      total: allResults.length,
      truncated
    };

    return response;
  });
};

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include?: string;
  exclude?: string;
  maxResults: number;
}

function searchInRepo(
  repoPath: string,
  repoId: string,
  repoName: string,
  query: string,
  mode: SearchMode,
  options: SearchOptions
): SearchResult[] {
  const results: SearchResult[] = [];

  try {
    if (mode === 'content') {
      // Use ripgrep if available, fallback to git grep
      const rgResults = searchWithRipgrep(repoPath, repoId, repoName, query, options);
      if (rgResults !== null) {
        return rgResults;
      }

      // Fallback to git grep
      return searchWithGitGrep(repoPath, repoId, repoName, query, options);
    } else if (mode === 'symbol') {
      // Symbol search using ctags or language-specific tools
      // For now, fall back to content search with word boundaries
      return searchWithRipgrep(repoPath, repoId, repoName, `\\b${query}\\b`, {
        ...options,
        regex: true
      }) ?? [];
    } else {
      // Filename search
      return searchFilenames(repoPath, repoId, repoName, query, options);
    }
  } catch (err) {
    console.error(`Search failed in ${repoPath}:`, err);
    return results;
  }
}

function searchWithRipgrep(
  repoPath: string,
  repoId: string,
  repoName: string,
  query: string,
  options: SearchOptions
): SearchResult[] | null {
  try {
    const args: string[] = ['--json', '--max-count', '1000'];

    if (!options.caseSensitive) args.push('-i');
    if (options.wholeWord) args.push('-w');
    if (!options.regex) args.push('-F'); // Fixed string
    if (options.include) args.push('--glob', options.include);
    if (options.exclude) args.push('--glob', `!${options.exclude}`);

    args.push('--', query, '.');

    const output = execSync(`rg ${args.join(' ')}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const results: SearchResult[] = [];

    for (const line of output.split('\n').filter(Boolean)) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'match') {
          const matchData = data.data;
          results.push({
            repoId,
            repoName,
            path: matchData.path.text,
            line: matchData.line_number,
            content: truncateContent(matchData.lines.text),
            matchType: 'content'
          });

          if (results.length >= options.maxResults) break;
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    return results;
  } catch (err: any) {
    if (err.status === 1) {
      // No matches found
      return [];
    }
    // ripgrep not available
    return null;
  }
}

function searchWithGitGrep(
  repoPath: string,
  repoId: string,
  repoName: string,
  query: string,
  options: SearchOptions
): SearchResult[] {
  const results: SearchResult[] = [];

  try {
    const args: string[] = ['-n']; // Show line numbers

    if (!options.caseSensitive) args.push('-i');
    if (options.wholeWord) args.push('-w');
    if (!options.regex) args.push('-F');

    args.push('--', query);

    const output = execSync(`git grep ${args.join(' ')}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    for (const line of output.split('\n').filter(Boolean)) {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        results.push({
          repoId,
          repoName,
          path: match[1] ?? '',
          line: parseInt(match[2] ?? '0', 10),
          content: truncateContent(match[3] ?? ''),
          matchType: 'content'
        });

        if (results.length >= options.maxResults) break;
      }
    }
  } catch (err: any) {
    if (err.status !== 1) {
      console.error('git grep failed:', err);
    }
  }

  return results;
}

function searchFilenames(
  repoPath: string,
  repoId: string,
  repoName: string,
  query: string,
  options: SearchOptions
): SearchResult[] {
  const results: SearchResult[] = [];

  try {
    // Use git ls-files for tracked files
    const output = execSync('git ls-files', {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const queryLower = options.caseSensitive ? query : query.toLowerCase();

    for (const file of output.split('\n').filter(Boolean)) {
      const searchTarget = options.caseSensitive ? file : file.toLowerCase();

      // Check include/exclude patterns
      if (options.include && !matchGlob(file, options.include)) continue;
      if (options.exclude && matchGlob(file, options.exclude)) continue;

      // Match query
      const matches = options.regex
        ? new RegExp(query, options.caseSensitive ? '' : 'i').test(file)
        : searchTarget.includes(queryLower);

      if (matches) {
        results.push({
          repoId,
          repoName,
          path: file,
          matchType: 'filename'
        });

        if (results.length >= options.maxResults) break;
      }
    }
  } catch (err) {
    console.error('Filename search failed:', err);
  }

  return results;
}

function truncateContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_CONTENT_LENGTH) return trimmed;
  return trimmed.substring(0, MAX_CONTENT_LENGTH) + '...';
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching (supports * and **)
  const regexPattern = pattern
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${regexPattern}$`).test(filePath);
}
