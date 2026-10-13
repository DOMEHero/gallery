import { createPerson, getAllPeople, reassignFaces, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import UnmergeFaceSelector from './UnmergeFaceSelector.svelte';

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    createPerson: vi.fn(),
    getAllPeople: vi.fn(),
    reassignFaces: vi.fn(),
  };
});

vi.mock('$lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

const person = (id: string, name: string, type: 'person' | 'pet', species: string | null): PersonResponseDto =>
  ({
    id,
    name,
    type,
    species,
    thumbnailPath: `/people/${id}/thumbnail`,
    birthDate: null,
    isHidden: false,
  }) as PersonResponseDto;

const renderSelector = (personAssets: PersonResponseDto, onConfirm = vi.fn()) =>
  render(
    TestWrapper as Component<{
      component: typeof UnmergeFaceSelector;
      componentProps: {
        assetIds: string[];
        personAssets: PersonResponseDto;
        onConfirm: () => void;
        onClose: () => void;
      };
    }>,
    {
      component: UnmergeFaceSelector,
      componentProps: { assetIds: ['asset-1'], personAssets, onConfirm, onClose: vi.fn() },
    },
  );

describe('UnmergeFaceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only offers pets of the same species as reassignment targets', async () => {
    const source = person('source-cat', 'Mochi', 'pet', 'cat');
    vi.mocked(getAllPeople).mockResolvedValue({
      people: [source, person('other-cat', 'Luna', 'pet', 'CAT'), person('dog', 'Rex', 'pet', 'dog')],
      total: 3,
      hidden: 0,
      hasNextPage: false,
    });

    renderSelector(source);

    await waitFor(() => expect(getAllPeople).toHaveBeenCalledWith({ withHidden: false, type: 'pet' }));
    expect(await screen.findByText('Luna')).toBeInTheDocument();
    expect(screen.queryByText('Rex')).not.toBeInTheDocument();
    expect(screen.queryByText('Mochi')).not.toBeInTheDocument();
  });

  it('creates a new pet identity with the source species before moving the selected faces', async () => {
    const source = person('source-cat', 'Mochi', 'pet', 'cat');
    const created = person('new-cat', '', 'pet', 'cat');
    const onConfirm = vi.fn();
    vi.mocked(getAllPeople).mockResolvedValue({ people: [], total: 0, hidden: 0, hasNextPage: false });
    vi.mocked(createPerson).mockResolvedValue(created);
    vi.mocked(reassignFaces).mockResolvedValue([]);

    renderSelector(source, onConfirm);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'create_new_pet' })).toHaveLength(2));
    await fireEvent.click(screen.getAllByRole('button', { name: 'create_new_pet' })[0]);

    await waitFor(() => {
      expect(createPerson).toHaveBeenCalledWith({ personCreateDto: { type: 'pet', species: 'cat' } });
      expect(reassignFaces).toHaveBeenCalledWith({
        id: created.id,
        assetFaceUpdateDto: { data: [{ assetId: 'asset-1', personId: source.id }] },
      });
      expect(onConfirm).toHaveBeenCalledOnce();
    });
  });
});
