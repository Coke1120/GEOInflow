import { bumpAnalyticsRevision } from '@/lib/liekan/upstream/analytics-revision';
import { invalidateWebsiteAnalytics } from '@/lib/liekan/upstream/query-cache';
import { Prisma, type Report } from '@/generated/prisma/client';
import prisma, { getRawQueryClient } from '@/lib/prisma';
import type { PageResult, QueryFilters } from '@/lib/types';

import ReportFindManyArgs = Prisma.ReportFindManyArgs;

export type ReportListItem = Report & {
  website?: {
    domain: string;
    userId: string;
  } | null;
};

async function findReport(criteria: Prisma.ReportFindUniqueArgs) {
  return (getRawQueryClient(prisma.client, { write: true }) as typeof prisma.client).report.findUnique(criteria);
}

export async function getReport(reportId: string) {
  return findReport({
    where: {
      id: reportId,
    },
  });
}

export async function getReports(
  criteria: ReportFindManyArgs,
  filters: QueryFilters = {},
): Promise<PageResult<ReportListItem[]>> {
  const { search } = filters;
  const orderBy = criteria.orderBy ?? [{ name: 'asc' }, { id: 'asc' }];

  const where: Prisma.ReportWhereInput = {
    ...criteria.where,
    ...prisma.getSearchParameters(search, [
      { name: 'contains' },
      { description: 'contains' },
      { type: 'contains' },
      {
        user: {
          username: 'contains',
        },
      },
      {
        website: {
          name: 'contains',
        },
      },
      {
        website: {
          domain: 'contains',
        },
      },
    ]),
  };

  return prisma.pagedQuery('report', { ...criteria, where, orderBy }, filters);
}

export async function getUserReports(userId: string, filters?: QueryFilters) {
  return getReports(
    {
      where: {
        userId,
      },
      include: {
        website: {
          select: {
            domain: true,
            userId: true,
          },
        },
      },
    },
    filters,
  );
}

export async function getWebsiteReports(websiteId: string, filters: QueryFilters = {}) {
  return getReports(
    {
      where: {
        websiteId,
      },
    },
    filters,
  );
}

export async function createReport(data: Prisma.ReportUncheckedCreateInput) {
  const result = await prisma.transaction(async tx => {
    const result = await tx.report.create({ data });
    await bumpAnalyticsRevision(tx, 'website', result.websiteId);
    return result;
  });
  invalidateWebsiteAnalytics(result.websiteId);
  return result;
}

export async function updateReport(reportId: string, data: any) {
  const result = await prisma.transaction(async tx => {
    const before = await tx.report.findUnique({ where: { id: reportId } });
    const result = await tx.report.update({ where: { id: reportId }, data });
    await bumpAnalyticsRevision(tx, 'website', result.websiteId, before?.websiteId);
    return result;
  });
  invalidateWebsiteAnalytics(result.websiteId);
  return result;
}

export async function deleteReport(reportId: string) {
  const result = await prisma.transaction(async tx => {
    const result = await tx.report.delete({ where: { id: reportId } });
    await bumpAnalyticsRevision(tx, 'website', result.websiteId);
    return result;
  });
  invalidateWebsiteAnalytics(result.websiteId);
  return result;
}
