<script lang="ts">
  import { focusOutside } from '$lib/actions/focus-outside';
  import DeferredPersonThumbnail from '$lib/components/people/deferred-person-thumbnail.svelte';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';
  import type { ManagedPerson } from '$lib/components/people/people-types';
  import type { ThumbnailLoadQueue } from '$lib/components/people/thumbnail-load-queue.svelte';
  import { getPetBadgeLabel } from '$lib/utils/pet-species';
  import { Icon } from '@immich/ui';
  import { mdiHeart, mdiPaw } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    person: ManagedPerson;
    showActionMenu?: boolean;
    deferThumbnail?: boolean;
    thumbnailQueue?: ThumbnailLoadQueue;
    actionMenu?: Snippet;
    footer?: Snippet;
    onDragStart?: (event: DragEvent, person: ManagedPerson) => void;
    onDragEnd?: () => void;
    canDrop?: (person: ManagedPerson) => boolean;
    onDrop?: (event: DragEvent, person: ManagedPerson) => void | Promise<void>;
  }

  let {
    person,
    showActionMenu = true,
    deferThumbnail = false,
    thumbnailQueue,
    actionMenu,
    footer,
    onDragStart,
    onDragEnd,
    canDrop,
    onDrop,
  }: Props = $props();
  let showActions = $state(false);
  let isDropTarget = $state(false);
  let groupElement: HTMLDivElement;

  const hideActionsUnlessFocused = () => {
    if (!groupElement.matches(':focus-within') && !groupElement.contains(document.activeElement)) {
      showActions = false;
    }
  };
</script>

<div
  bind:this={groupElement}
  class="relative"
  class:cursor-grab={!!onDragStart}
  role="group"
  draggable={!!onDragStart}
  ondragstart={(event) => onDragStart?.(event, person)}
  ondragend={() => {
    isDropTarget = false;
    onDragEnd?.();
  }}
  ondragover={(event) => {
    if (!canDrop?.(person)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    isDropTarget = true;
  }}
  ondragleave={() => (isDropTarget = false)}
  ondrop={(event) => {
    if (!canDrop?.(person)) {
      return;
    }

    event.preventDefault();
    isDropTarget = false;
    void onDrop?.(event, person);
  }}
  class:ring-2={isDropTarget}
  class:ring-primary={isDropTarget}
  onmouseenter={() => (showActions = true)}
  onmouseleave={hideActionsUnlessFocused}
  use:focusOutside={{ onFocusOut: () => (showActions = false) }}
>
  <a href={person.href} draggable="false" aria-label={person.displayName} onfocus={() => (showActions = true)}>
    <div class="size-full rounded-xl brightness-95 filter">
      {#if deferThumbnail && thumbnailQueue}
        <DeferredPersonThumbnail
          queue={thumbnailQueue}
          shadow
          url={person.thumbnailUrl}
          altText={person.displayName}
          title={person.displayName}
          widthStyle="100%"
          circle
        />
      {:else}
        <ImageThumbnail
          shadow
          url={person.thumbnailUrl}
          altText={person.displayName}
          title={person.displayName}
          widthStyle="100%"
          circle
          preload={false}
        />
      {/if}
      {#if person.isFavorite}
        <div class="absolute inset-s-4 top-4" aria-label={$t('favorite')} title={$t('favorite')}>
          <Icon icon={mdiHeart} size="24" class="text-white" />
        </div>
      {/if}
      {#if person.type === 'pet'}
        {@const petBadgeLabel = getPetBadgeLabel(person.species, $t)}
        <div
          class="absolute right-1 bottom-1 rounded-full bg-immich-primary p-1 text-white"
          role="img"
          aria-label={petBadgeLabel}
          title={petBadgeLabel}
        >
          <Icon icon={mdiPaw} size="16" class="text-white" />
        </div>
      {/if}
    </div>
  </a>

  {#if showActionMenu && actionMenu && showActions}
    <div class="absolute inset-e-2 top-2 z-1">
      {@render actionMenu()}
    </div>
  {/if}

  {@render footer?.()}
</div>
