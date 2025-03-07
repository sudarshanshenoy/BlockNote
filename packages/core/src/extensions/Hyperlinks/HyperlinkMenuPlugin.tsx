import { MantineProvider } from "@mantine/core";
import Tippy from "@tippyjs/react";
import { getMarkRange } from "@tiptap/core";
import { Mark, ResolvedPos } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import ReactDOM from "react-dom";
import { BlockNoteTheme } from "../../BlockNoteTheme";
import { HyperlinkMenu } from "./menus/HyperlinkMenu";
const PLUGIN_KEY = new PluginKey("HyperlinkMenuPlugin");

export const createHyperlinkMenuPlugin = () => {
  // as we always use Tippy appendTo(document.body), we can just create an element
  // that we use for ReactDOM, but it isn't used anywhere (except by React internally)
  const fakeRenderTarget = document.createElement("div");

  let hoveredLink: HTMLAnchorElement | undefined;
  let menuState: "cursor-based" | "mouse-based" | "hidden" = "hidden";
  let nextTippyKey = 0;

  return new Plugin({
    key: PLUGIN_KEY,
    view() {
      return {
        update: async (view, _prevState) => {
          const selection = view.state.selection;
          if (selection.from !== selection.to) {
            // don't show menu when we have an active selection
            if (menuState !== "hidden") {
              menuState = "hidden";
              ReactDOM.render(<></>, fakeRenderTarget);
            }
            return;
          }

          let pos: number | undefined;
          let resPos: ResolvedPos | undefined;
          let linkMark: Mark | undefined;
          let basedOnCursorPos = false;
          if (hoveredLink) {
            pos = view.posAtDOM(hoveredLink.firstChild!, 0);
            resPos = view.state.doc.resolve(pos);
            // based on https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/helpers/getMarkRange.ts
            const start = resPos.parent.childAfter(resPos.parentOffset).node;
            linkMark = start?.marks.find((m) => m.type.name.startsWith("link"));
          }

          if (
            !linkMark &&
            (view.hasFocus() || menuState === "cursor-based") // prevents re-opening menu after submission. Only open cursor-based menu if editor has focus
          ) {
            // no hovered link mark, try get from cursor position
            pos = selection.from;
            resPos = view.state.doc.resolve(pos);
            const start = resPos.parent.childAfter(resPos.parentOffset).node;
            linkMark = start?.marks.find((m) => m.type.name.startsWith("link"));
            basedOnCursorPos = true;
          }

          if (!linkMark || !pos || !resPos) {
            // The mouse-based popup takes care of hiding itself (tippy)
            // Because the cursor-based popup is has "showOnCreate", we want to hide it manually
            // if the cursor moves way
            if (menuState === "cursor-based") {
              menuState = "hidden";
              ReactDOM.render(<></>, fakeRenderTarget);
            }
            return;
          }

          const range = getMarkRange(resPos, linkMark.type, linkMark.attrs);
          if (!range) {
            return;
          }
          const text = view.state.doc.textBetween(range.from, range.to);
          const url = linkMark.attrs.href;

          const anchorPos = {
            // use the 'median' position of the range
            ...view.coordsAtPos(Math.round((range.from + range.to) / 2)),
            height: 0, // needed to satisfy types
            width: 0,
          };

          const foundLinkMark = linkMark; // typescript workaround for event handlers

          // A URL has to begin with http(s):// to be interpreted as an absolute path
          const editHandler = (href: string, text: string) => {
            menuState = "hidden";
            ReactDOM.render(<></>, fakeRenderTarget);

            // update the mark with new href
            (foundLinkMark as any).attrs = { ...foundLinkMark.attrs, href }; // TODO: invalid assign to attrs
            // insertText actually replaces the range with text
            const tr = view.state.tr.insertText(text, range.from, range.to);
            // the former range.to is no longer in use
            tr.addMark(range.from, range.from + text.length, foundLinkMark);
            view.dispatch(tr);
          };

          const removeHandler = () => {
            view.dispatch(
              view.state.tr
                .removeMark(range.from, range.to, foundLinkMark.type)
                .setMeta("preventAutolink", true)
            );
          };

          const hyperlinkMenu = (
            <MantineProvider theme={BlockNoteTheme}>
              <Tippy
                key={nextTippyKey + ""} // it could be tippy has "hidden" itself after mouseout. We use a key to get a new instance with a clean state.
                getReferenceClientRect={() => anchorPos as any}
                content={
                  <HyperlinkMenu
                    update={editHandler}
                    pos={anchorPos}
                    remove={removeHandler}
                    text={text}
                    url={url}
                  />
                }
                onHide={() => {
                  nextTippyKey++;
                  menuState = "hidden";
                }}
                aria={{ expanded: false }}
                interactive={true}
                interactiveBorder={30}
                triggerTarget={hoveredLink}
                showOnCreate={basedOnCursorPos}
                appendTo={document.body}>
                <div></div>
              </Tippy>
            </MantineProvider>
          );
          ReactDOM.render(hyperlinkMenu, fakeRenderTarget);
          menuState = basedOnCursorPos ? "cursor-based" : "mouse-based";
        },
      };
    },

    props: {
      handleDOMEvents: {
        // update view when an <a> is hovered over
        mouseover(view, event: any) {
          const newHoveredLink =
            event.target instanceof HTMLAnchorElement &&
            event.target.nodeName === "A"
              ? event.target
              : undefined;

          if (newHoveredLink !== hoveredLink) {
            // dispatch a meta transaction to make sure the view gets updated
            hoveredLink = newHoveredLink;

            view.dispatch(
              view.state.tr.setMeta(PLUGIN_KEY, { hoveredLinkChanged: true })
            );
          }
          return false;
        },
      },
    },
  });
};
