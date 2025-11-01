from manim import *

class BlackholeScene(Scene):
    def construct(self):
        # Create objects
        space = Rectangle(width=10, height=6, fill_opacity=0.0, stroke_width=0)
        blackhole = Circle(radius=0.5, fill_color=BLACK, fill_opacity=1)
        stars = VGroup(*[Circle(radius=0.2, fill_color=YELLOW, fill_opacity=1) for _ in range(5)])
        stars.arrange(RIGHT, buff=1)
        
        # Show space
        self.play(Create(space))
        self.wait(1)
        
        # Show caption 1
        caption1 = Text("कालो छिद्र क्या है?", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=3)
        self.wait(1)
        
        # Blackhole formation
        self.play(FadeIn(blackhole))
        self.wait(1)
        
        # Show caption 2
        self.play(FadeOut(caption1))
        caption2 = Text("कालो छिद्र को गुरुत्वाकर्षण", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=4)
        self.wait(1)
        
        # Star consumption
        self.play(FadeIn(stars))
        self.play(stars.animate.shift(LEFT * 3))
        self.play(stars[0].animate.scale(0.1), stars[1].animate.scale(0.1), stars[2].animate.scale(0.1), stars[3].animate.scale(0.1), stars[4].animate.scale(0.1))
        self.wait(1)
        
        # Show caption 3
        self.play(FadeOut(caption2))
        caption3 = Text("तारा जीवनकाल समाप्त", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=2)
        self.wait(1)
        
        # Space distortion
        self.play(space.animate.stretch(1.5, about_point=blackhole.get_center()))
        self.wait(2)