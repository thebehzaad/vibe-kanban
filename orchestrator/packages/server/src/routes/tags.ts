/**
 * Tags routes
 * Translates: crates/server/src/routes/tags.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import * as crypto from 'node:crypto';

// Types
export interface Tag {
  id: string;
  name: string;
  color: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagBody {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateTagBody {
  name?: string;
  color?: string;
  description?: string;
}

// Default colors for tags
const DEFAULT_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
];

// In-memory store
const tags = new Map<string, Tag>();

// Tag assignments (entity_type:entity_id -> tag_ids)
const tagAssignments = new Map<string, Set<string>>();

let colorIndex = 0;
function getNextColor(): string {
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length]!;
  colorIndex++;
  return color;
}

export const tagRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/tags - Get all tags
  fastify.get<{ Querystring: { search?: string } }>('/tags', async (request) => {
    const { search } = request.query;

    let tagList = Array.from(tags.values());

    // Filter by search query
    if (search) {
      const searchLower = search.toLowerCase();
      tagList = tagList.filter(tag =>
        tag.name.toLowerCase().includes(searchLower) ||
        tag.description?.toLowerCase().includes(searchLower)
      );
    }

    // Sort alphabetically
    tagList.sort((a, b) => a.name.localeCompare(b.name));

    return {
      tags: tagList,
      total: tagList.length
    };
  });

  // POST /api/tags - Create tag
  fastify.post<{ Body: CreateTagBody }>('/tags', async (request, reply) => {
    const { name, color, description } = request.body;

    // Check for duplicate name
    const existingTag = Array.from(tags.values()).find(
      t => t.name.toLowerCase() === name.toLowerCase()
    );
    if (existingTag) {
      return reply.status(409).send({ error: 'Tag with this name already exists' });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const tag: Tag = {
      id,
      name,
      color: color ?? getNextColor(),
      description,
      createdAt: now,
      updatedAt: now
    };

    tags.set(id, tag);

    fastify.log.info(`Tag created: ${id} (${name})`);

    return reply.status(201).send(tag);
  });

  // GET /api/tags/:tagId - Get tag by ID
  fastify.get<{ Params: { tagId: string } }>('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params;
    const tag = tags.get(tagId);

    if (!tag) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    return tag;
  });

  // PUT /api/tags/:tagId - Update tag
  fastify.put<{ Params: { tagId: string }; Body: UpdateTagBody }>(
    '/tags/:tagId',
    async (request, reply) => {
      const { tagId } = request.params;
      const updates = request.body;

      const tag = tags.get(tagId);
      if (!tag) {
        return reply.status(404).send({ error: 'Tag not found' });
      }

      // Check for duplicate name
      if (updates.name && updates.name.toLowerCase() !== tag.name.toLowerCase()) {
        const existingTag = Array.from(tags.values()).find(
          t => t.id !== tagId && t.name.toLowerCase() === updates.name!.toLowerCase()
        );
        if (existingTag) {
          return reply.status(409).send({ error: 'Tag with this name already exists' });
        }
      }

      const updatedTag: Tag = {
        ...tag,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      tags.set(tagId, updatedTag);

      return updatedTag;
    }
  );

  // DELETE /api/tags/:tagId - Delete tag
  fastify.delete<{ Params: { tagId: string } }>('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params;

    if (!tags.has(tagId)) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    tags.delete(tagId);

    // Remove tag from all assignments
    for (const [key, assignedTags] of tagAssignments) {
      if (assignedTags.has(tagId)) {
        assignedTags.delete(tagId);
        if (assignedTags.size === 0) {
          tagAssignments.delete(key);
        }
      }
    }

    fastify.log.info(`Tag deleted: ${tagId}`);

    return reply.status(204).send();
  });

  // POST /api/tags/:tagId/assign - Assign tag to entity
  fastify.post<{ Params: { tagId: string }; Body: { entityType: string; entityId: string } }>(
    '/tags/:tagId/assign',
    async (request, reply) => {
      const { tagId } = request.params;
      const { entityType, entityId } = request.body;

      if (!tags.has(tagId)) {
        return reply.status(404).send({ error: 'Tag not found' });
      }

      const key = `${entityType}:${entityId}`;
      let assigned = tagAssignments.get(key);
      if (!assigned) {
        assigned = new Set();
        tagAssignments.set(key, assigned);
      }

      assigned.add(tagId);

      return { success: true, entityType, entityId, tagId };
    }
  );

  // DELETE /api/tags/:tagId/assign - Remove tag from entity
  fastify.delete<{ Params: { tagId: string }; Querystring: { entity_type: string; entity_id: string } }>(
    '/tags/:tagId/assign',
    async (request, reply) => {
      const { tagId } = request.params;
      const { entity_type: entityType, entity_id: entityId } = request.query;

      const key = `${entityType}:${entityId}`;
      const assigned = tagAssignments.get(key);

      if (assigned) {
        assigned.delete(tagId);
        if (assigned.size === 0) {
          tagAssignments.delete(key);
        }
      }

      return reply.status(204).send();
    }
  );

  // GET /api/tags/entity/:entityType/:entityId - Get tags for entity
  fastify.get<{ Params: { entityType: string; entityId: string } }>(
    '/tags/entity/:entityType/:entityId',
    async (request) => {
      const { entityType, entityId } = request.params;

      const key = `${entityType}:${entityId}`;
      const assignedTagIds = tagAssignments.get(key) ?? new Set();

      const entityTags = Array.from(assignedTagIds)
        .map(id => tags.get(id))
        .filter((t): t is Tag => t !== undefined);

      return {
        entityType,
        entityId,
        tags: entityTags,
        total: entityTags.length
      };
    }
  );
};

// Export helpers
export function getTag(id: string): Tag | undefined {
  return tags.get(id);
}

export function getTagsForEntity(entityType: string, entityId: string): Tag[] {
  const key = `${entityType}:${entityId}`;
  const assignedTagIds = tagAssignments.get(key) ?? new Set();

  return Array.from(assignedTagIds)
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined);
}

export function assignTag(tagId: string, entityType: string, entityId: string): boolean {
  if (!tags.has(tagId)) return false;

  const key = `${entityType}:${entityId}`;
  let assigned = tagAssignments.get(key);
  if (!assigned) {
    assigned = new Set();
    tagAssignments.set(key, assigned);
  }

  assigned.add(tagId);
  return true;
}
