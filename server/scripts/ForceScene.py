from manim import *

class ForceScene(Scene):
    def construct(self):
        # Create objects
        arrow = Arrow(LEFT, RIGHT)
        mass = Circle(radius=0.5, color=BLUE)
        friction = Text("Friction", font_size=24).to_edge(UP)
        
        # Show introduction caption
        caption1 = Text("Introduction to Force", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=2)
        self.wait(1)
        
        # Show arrow and mass
        self.play(Create(arrow), Create(mass))
        self.wait(1)
        
        # Show force application caption
        self.play(FadeOut(caption1))
        caption2 = Text("Force Application", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        self.play(arrow.animate.shift(RIGHT * 2))
        self.wait(1)
        
        # Show mass resisting arrow
        self.play(FadeOut(caption2))
        caption3 = Text("Inertia and Resistance", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        self.play(mass.animate.shift(LEFT * 0.5))
        self.wait(2)
        
        # Show friction appears
        self.play(FadeOut(caption3))
        caption4 = Text("Friction Opposes Motion", font_size=28).to_edge(DOWN)
        self.play(Write(caption4), run_time=3)
        self.play(Create(friction))
        self.wait(1)
        
        # End of scene
        self.play(FadeOut(caption4), FadeOut(arrow), FadeOut(mass), FadeOut(friction))