/**
 * Tags routes
 * Translates: crates/server/src/routes/tags.rs
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { TagRepository } from '@runner/db';

// Re-export DB types for consumers
export type { Tag } from '@runner/db';

// Body interfaces for route typing
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

let colorIndex = 0;
function getNextColor(): string {
  const color = DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length]!;
  colorIndex++;
  return color;
}

export const tagRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const db = () => fastify.deployment.db();
  const getRepo = () => new TagRepository(db());

  // GET /api/tags - Get all tags
  fastify.get<{ Querystring: { search?: string } }>('/tags', async (request) => {
    const { search } = request.query;
    const repo = getRepo();

    const tagList = repo.findAll(search);

    return {
      tags: tagList,
      total: tagList.length
    };
  });

  // POST /api/tags - Create tag
  fastify.post<{ Body: CreateTagBody }>('/tags', async (request, reply) => {
    const { name, color, description } = request.body;
    const repo = getRepo();

    // Check for duplicate name
    const existingTag = repo.findByName(name);
    if (existingTag) {
      return reply.status(409).send({ error: 'Tag with this name already exists' });
    }

    const tag = repo.create({
      name,
      color: color ?? getNextColor(),
      description
    });

    fastify.log.info(`Tag created: ${tag.id} (${name})`);

    return reply.status(201).send(tag);
  });

  // GET /api/tags/:tagId - Get tag by ID
  fastify.get<{ Params: { tagId: string } }>('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params;
    const repo = getRepo();
    const tag = repo.findById(tagId);

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
      const repo = getRepo();

      const tag = repo.findById(tagId);
      if (!tag) {
        return reply.status(404).send({ error: 'Tag not found' });
      }

      // Check for duplicate name
      if (updates.name && updates.name.toLowerCase() !== tag.name.toLowerCase()) {
        const existingTag = repo.findByName(updates.name);
        if (existingTag && existingTag.id !== tagId) {
          return reply.status(409).send({ error: 'Tag with this name already exists' });
        }
      }

      const updatedTag = repo.update(tagId, updates);

      return updatedTag;
    }
  );

  // DELETE /api/tags/:tagId - Delete tag
  fastify.delete<{ Params: { tagId: string } }>('/tags/:tagId', async (request, reply) => {
    const { tagId } = request.params;
    const repo = getRepo();

    const tag = repo.findById(tagId);
    if (!tag) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    repo.delete(tagId);

    fastify.log.info(`Tag deleted: ${tagId}`);

    return reply.status(204).send();
  });

  // POST /api/tags/:tagId/assign - Assign tag to entity
  fastify.post<{ Params: { tagId: string }; Body: { entityType: string; entityId: string } }>(
    '/tags/:tagId/assign',
    async (request, reply) => {
      const { tagId } = request.params;
      const { entityType, entityId } = request.body;
      const repo = getRepo();

      const tag = repo.findById(tagId);
      if (!tag) {
        return reply.status(404).send({ error: 'Tag not found' });
      }

      repo.assignToEntity(tagId, entityType, entityId);

      return { success: true, entityType, entityId, tagId };
    }
  );

  // DELETE /api/tags/:tagId/assign - Remove tag from entity
  fastify.delete<{ Params: { tagId: string }; Querystring: { entity_type: string; entity_id: string } }>(
    '/tags/:tagId/assign',
    async (request, reply) => {
      const { tagId } = request.params;
      const { entity_type: entityType, entity_id: entityId } = request.query;
      const repo = getRepo();

      repo.removeFromEntity(tagId, entityType, entityId);

      return reply.status(204).send();
    }
  );

  // GET /api/tags/entity/:entityType/:entityId - Get tags for entity
  fastify.get<{ Params: { entityType: string; entityId: string } }>(
    '/tags/entity/:entityType/:entityId',
    async (request) => {
      const { entityType, entityId } = request.params;
      const repo = getRepo();

      const entityTags = repo.getTagsForEntity(entityType, entityId);

      return {
        entityType,
        entityId,
        tags: entityTags,
        total: entityTags.length
      };
    }
  );
};
