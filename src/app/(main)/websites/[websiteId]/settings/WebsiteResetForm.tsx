import { useQueryClient } from '@tanstack/react-query';
import { invalidateFeatureWebsiteQueries } from '@/lib/liekan/upstream/features-client';
import { TypeConfirmationForm } from '@/components/common/TypeConfirmationForm';
import { useMessages, useUpdateQuery } from '@/components/hooks';

const CONFIRM_VALUE = 'RESET';

export function WebsiteResetForm({
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
  const { mutateAsync, isPending, error } = useUpdateQuery(`/websites/${websiteId}/reset`);

  const handleConfirm = async () => {
    await mutateAsync(null, {
      onSuccess: async () => {
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
      buttonLabel={t(labels.reset)}
    />
  );
}
