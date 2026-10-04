import { useQueryClient } from '@tanstack/react-query';
import { invalidateFeatureWebsiteQueries } from '@/lib/liekan/upstream/features-client';
import { TypeConfirmationForm } from '@/components/common/TypeConfirmationForm';
import { useDeleteQuery, useMessages } from '@/components/hooks';

const CONFIRM_VALUE = 'DELETE';

export function WebsiteDeleteForm({
  websiteId,
  onSave,
  onClose,
}: {
  websiteId: string;
  onSave?: () => void;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const { t, labels } = useMessages();
  const { mutateAsync, isPending, error, touch } = useDeleteQuery(`/websites/${websiteId}`);

  const handleConfirm = async () => {
    await mutateAsync(null, {
      onSuccess: async () => {
        touch('websites');
        touch(`websites:${websiteId}`);
        await invalidateFeatureWebsiteQueries(queryClient, websiteId);
        onSave?.();
        onClose?.();
      },
    });
  };

  return (
    <TypeConfirmationForm
      confirmationValue={CONFIRM_VALUE}
      onConfirm={handleConfirm}
      onClose={onClose}
      isLoading={isPending}
      error={error}
      buttonLabel={t(labels.delete)}
      buttonVariant="danger"
    />
  );
}
