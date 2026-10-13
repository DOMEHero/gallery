<script lang="ts">
  import type { ManagedPerson } from '$lib/components/people/people-types';
  import { TooltipProvider } from '@immich/ui';
  import PersonTile from './person-tile.svelte';

  interface Props {
    person: ManagedPerson;
    showActionMenu?: boolean;
    showFooter?: boolean;
    onDragStart?: (event: DragEvent, person: ManagedPerson) => void;
    canDrop?: (person: ManagedPerson) => boolean;
    onDrop?: (event: DragEvent, person: ManagedPerson) => void | Promise<void>;
  }

  let { person, showActionMenu = false, showFooter = false, onDragStart, canDrop, onDrop }: Props = $props();
</script>

<TooltipProvider>
  <PersonTile {person} {showActionMenu} {onDragStart} {canDrop} {onDrop}>
    {#snippet actionMenu()}
      {#if showActionMenu}
        <button type="button">Actions</button>
      {/if}
    {/snippet}

    {#snippet footer()}
      {#if showFooter}
        <p>Footer content</p>
      {/if}
    {/snippet}
  </PersonTile>
</TooltipProvider>
